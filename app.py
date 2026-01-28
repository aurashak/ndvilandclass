from flask import Flask, jsonify, request
from flask_cors import CORS
import requests
import numpy as np
from PIL import Image
from io import BytesIO
import base64
from scipy import stats
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import os

app = Flask(__name__)
CORS(app)

# Configuration - Replace with your own credentials
CLIENT_ID = os.environ.get("COPERNICUS_CLIENT_ID", "your-client-id-here")
CLIENT_SECRET = os.environ.get("COPERNICUS_CLIENT_SECRET", "your-client-secret-here")

TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"
PROCESS_URL = "https://sh.dataspace.copernicus.eu/api/v1/process"

def get_access_token():
    """Get OAuth token from Copernicus Data Space"""
    data = {
        "grant_type": "client_credentials",
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET
    }
    
    try:
        response = requests.post(TOKEN_URL, data=data, timeout=10)
        if response.status_code == 200:
            return response.json()["access_token"]
        else:
            print(f"Token acquisition failed: HTTP {response.status_code}")
            return None
    except Exception as e:
        print(f"Token error: {e}")
        return None

def fetch_sentinel_ndvi(year, bbox, width=512, height=512):
    """Fetch NDVI data from Sentinel-2 with cloud masking"""
    token = get_access_token()
    if not token:
        return None, "Failed to get access token"

    date_ranges = {
        2018: ("2018-06-01", "2018-09-30"),
        2024: ("2024-06-01", "2024-09-30")
    }
    start_date, end_date = date_ranges.get(year, date_ranges[2024])

    evalscript = """
    //VERSION=3
    function setup() {
      return {
        input: [{
          bands: ["B04", "B08", "SCL", "dataMask"]
        }],
        output: {
          bands: 3,
          sampleType: "UINT16"
        }
      };
    }

    function evaluatePixel(sample) {
      let isCloud = (sample.SCL == 3 || sample.SCL == 8 || sample.SCL == 9 || 
                     sample.SCL == 10 || sample.SCL == 11);
      let isValid = !isCloud && sample.dataMask == 1;
      
      if (!isValid) {
        return [0, 0, 0];
      }
      
      let red = Math.min(65535, sample.B04 * 10000);
      let nir = Math.min(65535, sample.B08 * 10000);
      let mask = 65535;
      
      return [red, nir, mask];
    }
    """

    payload = {
        "input": {
            "bounds": {
                "bbox": [bbox['west'], bbox['south'], bbox['east'], bbox['north']],
                "properties": { "crs": "http://www.opengis.net/def/crs/EPSG/0/4326" }
            },
            "data": [{
                "type": "sentinel-2-l2a",
                "dataFilter": {
                    "timeRange": {
                        "from": f"{start_date}T00:00:00Z",
                        "to": f"{end_date}T23:59:59Z"
                    },
                    "maxCloudCoverage": 30,
                    "mosaickingOrder": "leastCC"
                }
            }]
        },
        "output": {
            "width": width,
            "height": height,
            "responses": [{
                "identifier": "default",
                "format": { "type": "image/png" }
            }]
        },
        "evalscript": evalscript
    }

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "image/png"
    }

    try:
        response = requests.post(PROCESS_URL, headers=headers, json=payload, timeout=90)
        
        if response.status_code == 200:
            img = Image.open(BytesIO(response.content))
            img_array = np.array(img, dtype=np.float32)
            
            red = img_array[:, :, 0]
            nir = img_array[:, :, 1]
            mask_vals = img_array[:, :, 2]
            
            mask_data = (mask_vals > 0).astype(np.uint8)
            
            denominator = nir + red
            ndvi_data = np.zeros_like(red)
            
            valid = (mask_data == 1) & (denominator > 0)
            ndvi_data[valid] = (nir[valid] - red[valid]) / denominator[valid]
            ndvi_data[~valid] = -999
            
            return (ndvi_data, mask_data), None
        else:
            return None, f"Error {response.status_code}"
    except Exception as e:
        print(f"NDVI fetch error: {e}")
        return None, str(e)

def classify_ndvi(ndvi, mask=None, context="urban"):
    """Classify NDVI with context-aware thresholds"""
    classes = np.zeros_like(ndvi, dtype=int)
    
    if mask is not None:
        classes[mask == 0] = -1
    
    valid = (mask == 1) if mask is not None else np.ones_like(ndvi, dtype=bool)
    
    thresholds = {
        "urban": [-0.1, 0.2, 0.35, 0.5]
    }
    t = thresholds["urban"]

    classes[(ndvi < t[0]) & valid] = 0
    classes[(ndvi >= t[0]) & (ndvi < t[1]) & valid] = 1
    classes[(ndvi >= t[1]) & (ndvi < t[2]) & valid] = 2
    classes[(ndvi >= t[2]) & (ndvi < t[3]) & valid] = 3
    classes[(ndvi >= t[3]) & valid] = 4
    
    return classes

def create_change_visualization(classes_2018, classes_2024, mask_2018=None, mask_2024=None):
    """Create change visualization with transparent no-change pixels"""
    height, width = classes_2018.shape
    rgba_image = np.zeros((height, width, 4), dtype=np.uint8)
    
    if mask_2018 is not None and mask_2024 is not None:
        valid = (mask_2018 == 1) & (mask_2024 == 1)
    else:
        valid = np.ones_like(classes_2018, dtype=bool)
    
    change = classes_2024.astype(int) - classes_2018.astype(int)
    
    rgba_image[valid & (change == 0)] = [0, 0, 0, 0]
    
    for i in range(1, 5):
        intensity = min(255, 100 + i * 40)
        rgba_image[valid & (change == i)] = [0, intensity, 0, 255]
        rgba_image[valid & (change == -i)] = [intensity, 0, 0, 255]
    
    rgba_image[~valid] = [0, 0, 0, 255]
    
    return rgba_image

def create_classification_map(classes, mask=None):
    """Create standard land cover classification map"""
    height, width = classes.shape
    rgb_image = np.zeros((height, width, 3), dtype=np.uint8)
    
    colors = {
        -1: [0, 0, 0],
        0: [0, 0, 255],
        1: [128, 128, 128],
        2: [255, 255, 128],
        3: [144, 238, 144],
        4: [34, 139, 34]
    }
    
    for class_id, color in colors.items():
        rgb_image[classes == class_id] = color
    
    return rgb_image

def analyze_classification(classes, mask=None):
    """Calculate land cover statistics"""
    valid_pixels = (classes >= 0)
    if mask is not None:
        valid_pixels = valid_pixels & (mask == 1)
    
    total = valid_pixels.sum()
    
    if total == 0:
        return None
    
    results = {
        "water": float(((classes == 0) & valid_pixels).sum() / total * 100),
        "bare_urban": float(((classes == 1) & valid_pixels).sum() / total * 100),
        "sparse_veg": float(((classes == 2) & valid_pixels).sum() / total * 100),
        "moderate_veg": float(((classes == 3) & valid_pixels).sum() / total * 100),
        "dense_veg": float(((classes == 4) & valid_pixels).sum() / total * 100),
        "cloud_masked": float((mask == 0).sum() / classes.size * 100) if mask is not None else 0.0
    }
    
    return results

def perform_ndvi_change_analysis(ndvi_2018, ndvi_2024, classes_2018, classes_2024, mask_2018=None, mask_2024=None):
    """Analyze NDVI change magnitude vs urban expansion"""
    if mask_2018 is not None and mask_2024 is not None:
        valid = (mask_2018 == 1) & (mask_2024 == 1)
    else:
        valid = np.ones_like(classes_2018, dtype=bool)
    
    total_valid = np.sum(valid)
    
    ndvi_change = ndvi_2024 - ndvi_2018
    ndvi_change_valid = ndvi_change[valid].flatten()
    
    urban_gain = ((classes_2018 != 1) & (classes_2024 == 1)).astype(int)
    urban_gain_valid = urban_gain[valid].flatten()
    
    pixels_with_urban_gain = np.sum(urban_gain_valid)
    mean_ndvi_change = ndvi_change_valid.mean()
    mean_ndvi_change_urban = ndvi_change_valid[urban_gain_valid == 1].mean() if pixels_with_urban_gain > 0 else 0
    mean_ndvi_change_non_urban = ndvi_change_valid[urban_gain_valid == 0].mean()
    
    if len(ndvi_change_valid) > 10:
        r_value, p_value = stats.pearsonr(urban_gain_valid, ndvi_change_valid)
        r_squared = r_value ** 2
        
        slope, intercept, r_val, p_val, std_err = stats.linregress(urban_gain_valid, ndvi_change_valid)
        
        fig, ax = plt.subplots(figsize=(10, 6))
        
        sample_size = min(10000, len(urban_gain_valid))
        sample_indices = np.random.choice(len(urban_gain_valid), sample_size, replace=False)
        
        x_sample = urban_gain_valid[sample_indices]
        y_sample = ndvi_change_valid[sample_indices]
        
        scatter = ax.scatter(x_sample, y_sample, 
                            c=y_sample, 
                            cmap='RdYlGn', 
                            alpha=0.5, 
                            s=10,
                            vmin=-0.5, 
                            vmax=0.5)
        
        x_line = np.array([0, 1])
        y_line = slope * x_line + intercept
        ax.plot(x_line, y_line, 'r-', linewidth=2, 
                label=f'Linear fit: y = {slope:.3f}x + {intercept:.3f}')
        
        ax.set_xlabel('Urban Expansion (0=No, 1=Yes)', fontsize=12)
        ax.set_ylabel('NDVI Change (2024 - 2018)', fontsize=12)
        ax.set_title(f'Pearson r = {r_value:.3f}, R² = {r_squared:.3f}, p = {p_value:.4f}', 
                     fontsize=14, fontweight='bold')
        ax.legend()
        ax.grid(True, alpha=0.3)
        ax.axhline(y=0, color='k', linestyle='--', linewidth=0.5, alpha=0.5)
        
        cbar = plt.colorbar(scatter, ax=ax)
        cbar.set_label('NDVI Change', rotation=270, labelpad=15)
        
        buffer = BytesIO()
        plt.savefig(buffer, format='png', dpi=100, bbox_inches='tight')
        plt.close()
        regression_chart_b64 = base64.b64encode(buffer.getvalue()).decode()
        
        if abs(r_value) > 0.7:
            strength = "strong"
        elif abs(r_value) > 0.4:
            strength = "moderate"
        else:
            strength = "weak"
        
        correlation_interpretation = f"There is a {strength} {'positive' if r_value > 0 else 'negative'} correlation (r = {r_value:.3f}) between urban expansion and NDVI change."
        regression_interpretation = f"The regression model explains {r_squared*100:.1f}% of the variance in NDVI change."
        
        return {
            "regression_chart": regression_chart_b64,
            "statistical_analysis": {
                "correlation": {
                    "r": float(r_value),
                    "r_squared": float(r_squared),
                    "p_value": float(p_value),
                    "significant": bool(p_value < 0.05),
                    "interpretation": correlation_interpretation
                },
                "regression": {
                    "coefficient": float(slope),
                    "intercept": float(intercept),
                    "r_squared": float(r_val ** 2),
                    "p_value": float(p_val),
                    "std_error": float(std_err),
                    "equation": f"NDVI Change = {slope:.4f} × Urban Gain + {intercept:.4f}",
                    "interpretation": regression_interpretation
                },
                "summary": {
                    "total_valid_pixels": int(total_valid),
                    "pixels_with_urban_gain": int(pixels_with_urban_gain),
                    "urban_gain_percentage": float(pixels_with_urban_gain / total_valid * 100),
                    "mean_ndvi_change_all": float(mean_ndvi_change),
                    "mean_ndvi_change_urban": float(mean_ndvi_change_urban),
                    "mean_ndvi_change_non_urban": float(mean_ndvi_change_non_urban)
                }
            }
        }
    else:
        return None

@app.route('/api/classify-area', methods=['POST'])
def classify_area():
    """Main analysis endpoint"""
    data = request.json
    
    north = data.get("north")
    south = data.get("south")
    east = data.get("east")
    west = data.get("west")
    zoom = data.get("zoom", 13)
    context = "urban"

    if not all([north, south, east, west]):
        return jsonify({"error": "Missing bounds"}), 400
    
    bbox = {'north': north, 'south': south, 'east': east, 'west': west}
    lat_diff = north - south
    approx_res = lat_diff * 111000 / 512
    
    result_2018, error_2018 = fetch_sentinel_ndvi(2018, bbox)
    if result_2018 is None:
        return jsonify({"error": f"2018 data failed: {error_2018}"}), 500
    
    ndvi_2018, mask_2018 = result_2018
    
    result_2024, error_2024 = fetch_sentinel_ndvi(2024, bbox)
    if result_2024 is None:
        return jsonify({"error": f"2024 data failed: {error_2024}"}), 500
    
    ndvi_2024, mask_2024 = result_2024

    classes_2018 = classify_ndvi(ndvi_2018, mask_2018, context)
    classes_2024 = classify_ndvi(ndvi_2024, mask_2024, context)
    
    results_2018 = analyze_classification(classes_2018, mask_2018)
    results_2024 = analyze_classification(classes_2024, mask_2024)

    statistical_results = perform_ndvi_change_analysis(ndvi_2018, ndvi_2024, classes_2018, classes_2024, mask_2018, mask_2024)
    
    def classes_to_base64(classes):
        rgb = create_classification_map(classes)
        pil_img = Image.fromarray(rgb)
        buffer = BytesIO()
        pil_img.save(buffer, format='PNG')
        return base64.b64encode(buffer.getvalue()).decode()
    
    class_img_2018 = classes_to_base64(classes_2018)
    class_img_2024 = classes_to_base64(classes_2024)
    
    change_image = create_change_visualization(classes_2018, classes_2024, mask_2018, mask_2024)
    pil_image = Image.fromarray(change_image, mode='RGBA')
    buffer = BytesIO()
    pil_image.save(buffer, format='PNG')
    change_image_b64 = base64.b64encode(buffer.getvalue()).decode()

    veg_change = (results_2024["moderate_veg"] + results_2024["dense_veg"]) - \
                 (results_2018["moderate_veg"] + results_2018["dense_veg"])
    
    changes = {
        "water": float(results_2024["water"] - results_2018["water"]),
        "bare_urban": float(results_2024["bare_urban"] - results_2018["bare_urban"]),
        "sparse_veg": float(results_2024["sparse_veg"] - results_2018["sparse_veg"]),
        "moderate_veg": float(results_2024["moderate_veg"] - results_2018["moderate_veg"]),
        "dense_veg": float(results_2024["dense_veg"] - results_2018["dense_veg"])
    }
    
    summary = {
        "vegetation_increase": float(round(veg_change, 2)),
        "urban_increase": float(round(changes["bare_urban"], 2)),
        "overall_trend": "Vegetation growth" if veg_change > 0 else "Vegetation loss" if veg_change < 0 else "Stable",
        "zoom_level": zoom,
        "resolution_m": float(round(approx_res, 1))
    }

    response_data = {
        "status": "success",
        "data_type": "REAL_NDVI",
        "source": "Copernicus Sentinel-2 L2A",
        "method": "NDVI from NIR (B8) and Red (B4) bands",
        "cloud_masking": True,
        "context": context,
        "year_2018": {**results_2018, "classification_image": class_img_2018},
        "year_2024": {**results_2024, "classification_image": class_img_2024},
        "changes": changes,
        "change_image": change_image_b64,
        "summary": summary
    }

    if statistical_results:
        response_data["regression_chart"] = statistical_results["regression_chart"]
        response_data["statistical_analysis"] = statistical_results["statistical_analysis"]

    return jsonify(response_data)

if __name__ == '__main__':
    app.run(debug=True, port=5000)
