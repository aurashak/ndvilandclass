A web-based application for analyzing vegetation changes in urban and suburban contexts between 2018 and 2024 using the Normalized Difference Vegetation Index (NDVI) and open-source satellite imagery.

Overview
This tool provides an accessible method for researchers, planners, and community members to analyze land cover changes using freely available Sentinel-2 satellite data. The system processes multispectral imagery to classify pixels into five land cover categories and performs statistical analysis to quantify relationships between urbanization and vegetation change.

Online Tool: [terrestrialresearch.com/machinelearning/landclass2](https://terrestrialresearch.com/machinelearning/landclass2)

System includes
- Interactive map interface for selecting analysis areas
- Automated NDVI calculation and land classification
- Temporal comparison (2018 vs 2024)
- Statistical analysis (correlation and regression)
- Visual data presentation with charts and maps
- Five-category land cover classification system

System Architecture
Frontend
- HTML5/CSS3 - User interface structure and styling
- JavaScript ES6 - Application logic and interactivity
- Leaflet.js - Interactive mapping framework

Backend
- Python 3.11+
  - Pillow (PIL)
  - NumPy 1.24+
  - SciPy 1.10+
  - Matplotlib 3.7+
  - Requests-
- PHP 8.1+
  
Data Sources
- ESA Sentinel-2- Multispectral satellite imagery (10m resolution)
- Copernicus Data Space- Satellite data access portal

Installation 
Prerequisites
- Web server (Apache/Nginx)
- PHP 8.1+
- Python 3.11+
- ESA Copernicus account (free registration)

Methodology
NDVI Calculation
The Normalized Difference Vegetation Index is calculated for each pixel:
NDVI = (NIR - Red) / (NIR + Red)

Where:
- NIR = Near-Infrared band reflectance
- Red = Red band reflectance

Statistical Analysis
Urban Gain Detection:
```python
urban_gain = ((classes_2018 != 1) & (classes_2024 == 1)).astype(int)
```

NDVI Change:
ndvi_change = ndvi_2024 - ndvi_2018

Pearson Correlation:
r_value, p_value = stats.pearsonr(urban_gain, ndvi_change)

Linear Regression:
slope, intercept, r_value, p_value, std_err = stats.linregress(urban_gain, ndvi_change)


Limitations
Current Constraints
- Resolution: 10m per pixel (Sentinel-2 MSI)
- Temporal range: 2018-2024 (consistent public data availability)
- Cloud cover: May require multiple image acquisitions
- Geographic scope: Optimized for urban/suburban contexts (excludes rainforest, deep water, ice)
- Accuracy: Lower than commercial VHR imagery (30cm resolution)




