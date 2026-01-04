/**
 * ========================================
 * URBAN HEAT/COLD VULNERABILITY ASSESSMENT SYSTEM
 * ========================================
 * 
 * RESEARCH CONTRIBUTIONS:
 * 1. Z-score based deviation detection using historic baseline
 * 2. Composite vulnerability metric (60% temperature deviation + 40% elderly demographics)
 * 3. Multi-threshold risk classification (extreme: 1.5σ, very-high: 1.2σ, high: 0.9σ, elevated: 0.5σ)
 * 4. Cumulative risk pattern analysis across census tracts
 * 
 * Data Collection: 3x daily (6am, 2pm, 10pm EST) via OpenWeatherMap API
 * Study Area: Manhattan, NYC (288 census tracts)
 * Population Focus: Adults aged 65+ (vulnerable demographic)
 * 
 * Full implementation: [link] | Paper: [DOI]
 */

// ========================================
// CONFIGURATION & STATE
// ========================================

const CONFIG = {
    UPDATE_TIMES: [6, 14, 22], // 6am, 2pm, 10pm EST
    HOURS_BETWEEN_UPDATES: 8
};

// Map layers & data stores
let aqMapInstance, censusTractLayerAQ, manhattanBoundary;
let currentTemperatureData = [], temperatureStats = null;
let heatVulnerabilityLayer, coldVulnerabilityLayer;
let heatDeviationLayer, coldDeviationLayer;
let cumulativeHeatLayer, cumulativeColdLayer;

// Historic baseline (loaded from cumulative database)
let historicBaseline = {
    mean: null,      // Global average across all observations
    stdDev: null,    // For z-score calculations
    loaded: false
};

// ========================================
// MAP INITIALIZATION (Leaflet - Standard)
// ========================================
// Condensed for academic review - see Leaflet docs
if (document.getElementById('aqmap')) {
    aqMapInstance = L.map('aqmap', {
        minZoom: 11, maxZoom: 18
    }).setView([40.7831, -73.9712], 13);
    
    L.control.zoom({ position: 'topright' }).addTo(aqMapInstance);
    aqMapInstance.setMaxBounds(L.latLngBounds(
        L.latLng(40.6800, -74.0200),
        L.latLng(40.8820, -73.9100)
    ));
    
    L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { attribution: '&copy; Esri', maxZoom: 19, opacity: 0.7 }
    ).addTo(aqMapInstance);
}

// ========================================
// STATISTICAL FUNCTIONS (CORE ALGORITHMS)
// ========================================

/**
 * Calculate standard deviation
 * Used in z-score normalization and deviation detection
 */
function calculateStandardDeviation(values) {
    if (!values || values.length === 0) return 0;
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
    return Math.sqrt(variance);
}

/**
 * Calculate z-score: (value - mean) / stdDev
 * Standardizes temperature relative to historic baseline
 * 
 * Interpretation:
 * |z| < 0.5: Normal range
 * 0.5-1.0: Moderate deviation
 * 1.0-1.5: High deviation
 * 1.5-2.0: Very high deviation
 * ≥2.0: Extreme deviation
 */
function calculateZScore(value, mean, stdDev) {
    if (stdDev === 0) return 0;
    return (value - mean) / stdDev;
}

// ========================================
// DATA COLLECTION
// ========================================

/**
 * Fetch temperature data from database
 * Pipeline: OpenWeatherMap API → PHP → MySQL → Application
 */
async function fetchTemperatureData() {
    try {
        const response = await fetch('get_latest_temperatures.php');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const result = await response.json();
        if (!result.success) throw new Error(result.error);
        
        return result.data.map(item => ({
            lat: item.lat,
            lon: item.lon,
            temp_f: item.temperature_f,
            temp_c: item.temperature_c,
            tractId: item.tract_id,
            tractName: item.tract_name,
            elderlyCount: item.elderly_65plus
        }));
    } catch (error) {
        console.error('Data fetch error:', error);
        return [];
    }
}

/**
 * Fetch cumulative statistics and historic baseline
 * CRITICAL: Loads mean/stdDev for z-score calculations
 */
async function fetchRiskStatistics() {
    try {
        const response = await fetch('get_risk_statistics.php');
        if (!response.ok) return;
        
        const data = await response.json();
        if (!data.success) return;

        // Load historic baseline from database
        if (data.global_averages) {
            historicBaseline = {
                mean: data.global_averages.temperature,
                stdDev: data.global_averages.stddev_temp,
                loaded: true
            };
            console.log('Historic baseline loaded:', historicBaseline);
        }

        // Update UI with statistics (implementation omitted)
        updateStatisticsDisplay(data);
    } catch (error) {
        console.error('Error fetching statistics:', error);
    }
}

// ========================================
// VULNERABILITY LAYERS (RESEARCH CORE)
// ========================================

/**
 * CREATE HEAT VULNERABILITY LAYER
 * 
 * Algorithm:
 *   Risk Score = (Z-score × 0.6) + (Elderly % × 0.4)
 * 
 * Where:
 *   Z-score = (current_temp - historic_mean) / historic_stddev
 *   Elderly % = tract_elderly / max_elderly (normalized 0-1)
 * 
 * Thresholds:
 *   Extreme: ≥1.5 (95th+ percentile)
 *   Very High: 1.2-1.5 (85th-95th)
 *   High: 0.9-1.2 (75th-85th)
 *   Elevated: 0.5-0.9 (65th-75th)
 * 
 * Only displays tracts with Z ≥ +0.5σ
 */
function createHeatVulnerabilityLayerSD() {
    if (!manhattanBoundary || !currentTemperatureData.length) return null;
    if (!historicBaseline.loaded) return null;
    
    const mean = historicBaseline.mean;
    const stdDev = historicBaseline.stdDev;
    const maxElderly = Math.max(
        ...manhattanBoundary.features.map(f => f.properties.Old_Age_65plus || 0)
    );
    
    return L.geoJSON(manhattanBoundary, {
        style: feature => {
            const tractId = feature.properties.geoid;
            const elderlyCount = feature.properties.Old_Age_65plus || 0;
            const tempData = currentTemperatureData.find(d => d.tractId === tractId);
            
            if (tempData) {
                const zScore = (tempData.temp_f - mean) / stdDev;
                
                // Only classify above-average temperatures
                if (zScore >= 0.5) {
                    const elderlyScore = elderlyCount / maxElderly;
                    const riskScore = (zScore * 0.6) + (elderlyScore * 0.4);
                    
                    // Determine risk level
                    let color = null;
                    if (riskScore >= 1.5) color = '#8B0000';      // Extreme
                    else if (riskScore >= 1.2) color = '#FF4500'; // Very high
                    else if (riskScore >= 0.9) color = '#FF8C00';  // High
                    else if (riskScore >= 0.5) color = '#FFD700';  // Elevated
                    
                    if (color) {
                        return {
                            fillColor: color,
                            fillOpacity: 0.75,
                            color: '#000',
                            weight: 1.5
                        };
                    }
                }
            }
            
            // No risk or insufficient data
            return {
                fillColor: '#d3d3d3',
                fillOpacity: 0.3,
                color: '#333',
                weight: 1
            };
        }
    });
}

/**
 * CREATE COLD VULNERABILITY LAYER
 * 
 * Same algorithm as heat, but:
 * - Uses |Z| when Z ≤ -0.5σ
 * - Blue color palette
 */
function createColdVulnerabilityLayerSD() {
    if (!manhattanBoundary || !currentTemperatureData.length) return null;
    if (!historicBaseline.loaded) return null;
    
    const mean = historicBaseline.mean;
    const stdDev = historicBaseline.stdDev;
    const maxElderly = Math.max(
        ...manhattanBoundary.features.map(f => f.properties.Old_Age_65plus || 0)
    );
    
    return L.geoJSON(manhattanBoundary, {
        style: feature => {
            const tractId = feature.properties.geoid;
            const elderlyCount = feature.properties.Old_Age_65plus || 0;
            const tempData = currentTemperatureData.find(d => d.tractId === tractId);
            
            if (tempData) {
                const zScore = (tempData.temp_f - mean) / stdDev;
                
                // Only classify below-average temperatures
                if (zScore <= -0.5) {
                    const absZScore = Math.abs(zScore);
                    const elderlyScore = elderlyCount / maxElderly;
                    const riskScore = (absZScore * 0.6) + (elderlyScore * 0.4);
                    
                    let color = null;
                    if (riskScore >= 1.5) color = '#00008B';      // Extreme
                    else if (riskScore >= 1.2) color = '#0000CD'; // Very high
                    else if (riskScore >= 0.9) color = '#4169E1';  // High
                    else if (riskScore >= 0.5) color = '#87CEEB';  // Elevated
                    
                    if (color) {
                        return {
                            fillColor: color,
                            fillOpacity: 0.75,
                            color: '#000',
                            weight: 1.5
                        };
                    }
                }
            }
            
            return {
                fillColor: '#d3d3d3',
                fillOpacity: 0.3,
                color: '#333',
                weight: 1
            };
        }
    });
}

/**
 * DEVIATION LAYERS (Temperature Only)
 * Pure statistical analysis without demographic weighting
 */
function createHeatDeviationLayerSD() {
    if (!manhattanBoundary || !currentTemperatureData.length) return null;
    
    const temps = currentTemperatureData.map(d => d.temp_f);
    const mean = temps.reduce((sum, t) => sum + t, 0) / temps.length;
    const stdDev = calculateStandardDeviation(temps);
    
    return L.geoJSON(manhattanBoundary, {
        style: feature => {
            const tempData = currentTemperatureData.find(
                d => d.tractId === feature.properties.geoid
            );
            
            if (tempData) {
                const zScore = (tempData.temp_f - mean) / stdDev;
                
                // Classify by z-score thresholds
                if (zScore >= 2.0) return { fillColor: '#8B0000', fillOpacity: 0.7 };
                if (zScore >= 1.5) return { fillColor: '#FF4500', fillOpacity: 0.7 };
                if (zScore >= 1.0) return { fillColor: '#FF8C00', fillOpacity: 0.7 };
                if (zScore >= 0.5) return { fillColor: '#FFD700', fillOpacity: 0.7 };
            }
            
            return { fillColor: '#d3d3d3', fillOpacity: 0.3 };
        }
    });
}

function createColdDeviationLayerSD() {
    if (!manhattanBoundary || !currentTemperatureData.length) return null;
    
    const temps = currentTemperatureData.map(d => d.temp_f);
    const mean = temps.reduce((sum, t) => sum + t, 0) / temps.length;
    const stdDev = calculateStandardDeviation(temps);
    
    return L.geoJSON(manhattanBoundary, {
        style: feature => {
            const tempData = currentTemperatureData.find(
                d => d.tractId === feature.properties.geoid
            );
            
            if (tempData) {
                const zScore = (tempData.temp_f - mean) / stdDev;
                
                if (zScore <= -2.0) return { fillColor: '#00008B', fillOpacity: 0.7 };
                if (zScore <= -1.5) return { fillColor: '#0000CD', fillOpacity: 0.7 };
                if (zScore <= -1.0) return { fillColor: '#4169E1', fillOpacity: 0.7 };
                if (zScore <= -0.5) return { fillColor: '#87CEEB', fillOpacity: 0.7 };
            }
            
            return { fillColor: '#d3d3d3', fillOpacity: 0.3 };
        }
    });
}

// ========================================
// CUMULATIVE RISK ANALYSIS
// ========================================

/**
 * Fetch cumulative deviation patterns
 * Analyzes historical frequency of extreme temperatures by tract
 */
async function fetchCumulativeDeviations() {
    try {
        const response = await fetch('get_risk_statistics.php');
        const data = await response.json();
        
        if (data.success && data.tracts) {
            cumulativeDeviationData = data.tracts;
            console.log('Cumulative data loaded:', cumulativeDeviationData.length);
        }
    } catch (error) {
        console.error('Error fetching cumulative data:', error);
    }
}

/**
 * CREATE CUMULATIVE HEAT LAYER
 * Shows historical heat patterns (average z-score + frequency)
 */
function createCumulativeHeatLayer() {
    if (!cumulativeDeviationData || !manhattanBoundary) return null;
    
    return L.geoJSON(manhattanBoundary, {
        style: feature => {
            const tractData = cumulativeDeviationData.find(
                d => d.tract_id === feature.properties.geoid
            );
            
            if (!tractData) return { fillColor: '#d3d3d3', fillOpacity: 0.3 };
            
            const avgZ = parseFloat(tractData.cumulative_heat_risk);
            const freq = parseFloat(tractData.heat_frequency);
            
            if (avgZ < 0.3 || freq < 0.1) {
                return { fillColor: '#d3d3d3', fillOpacity: 0.3 };
            }
            
            // Color by average z-score, opacity by frequency
            let color = '#FFD700';
            if (avgZ >= 2.0) color = '#8B0000';
            else if (avgZ >= 1.5) color = '#FF4500';
            else if (avgZ >= 1.0) color = '#FF8C00';
            
            const opacity = Math.min(0.4 + (freq * 0.5), 0.9);
            
            return {
                fillColor: color,
                fillOpacity: opacity,
                color: '#000',
                weight: 1.5
            };
        }
    });
}

function createCumulativeColdLayer() {
    if (!cumulativeDeviationData || !manhattanBoundary) return null;
    
    return L.geoJSON(manhattanBoundary, {
        style: feature => {
            const tractData = cumulativeDeviationData.find(
                d => d.tract_id === feature.properties.geoid
            );
            
            if (!tractData) return { fillColor: '#d3d3d3', fillOpacity: 0.3 };
            
            const avgZ = parseFloat(tractData.cumulative_cold_risk);
            const freq = parseFloat(tractData.cold_frequency);
            
            if (avgZ < 0.3 || freq < 0.1) {
                return { fillColor: '#d3d3d3', fillOpacity: 0.3 };
            }
            
            let color = '#87CEEB';
            if (avgZ >= 2.0) color = '#00008B';
            else if (avgZ >= 1.5) color = '#0000CD';
            else if (avgZ >= 1.0) color = '#4169E1';
            
            const opacity = Math.min(0.4 + (freq * 0.5), 0.9);
            
            return {
                fillColor: color,
                fillOpacity: opacity,
                color: '#000',
                weight: 1.5
            };
        }
    });
}

// ========================================
// INITIALIZATION
// ========================================

async function initializeSystem() {
    // Load census tract boundaries
    const boundaryData = await fetch("2020tractsage_with_age.geojson").then(r => r.json());
    manhattanBoundary = {
        ...boundaryData,
        features: boundaryData.features.filter(f => f.properties.borocode === '1')
    };
    
    // Create base census tract layer
    censusTractLayerAQ = L.geoJSON(manhattanBoundary, {
        style: { color: "#222", weight: 1.5, fillOpacity: 0.05 }
    }).addTo(aqMapInstance);
    
    // Load data and create risk layers
    await fetchRiskStatistics(); // Loads historic baseline
    await fetchCumulativeDeviations();
    
    currentTemperatureData = await fetchTemperatureData();
    temperatureStats = calculateStats(currentTemperatureData);
    
    // Create vulnerability layers
    heatVulnerabilityLayer = createHeatVulnerabilityLayerSD();
    coldVulnerabilityLayer = createColdVulnerabilityLayerSD();
    heatDeviationLayer = createHeatDeviationLayerSD();
    coldDeviationLayer = createColdDeviationLayerSD();
    cumulativeHeatLayer = createCumulativeHeatLayer();
    cumulativeColdLayer = createCumulativeColdLayer();
    
    console.log('System initialized');
}

// Calculate basic statistics
function calculateStats(data) {
    if (!data || data.length === 0) return null;
    const tempsF = data.map(d => d.temp_f);
    return {
        minTempF: Math.min(...tempsF),
        maxTempF: Math.max(...tempsF),
        avgTempF: tempsF.reduce((a, b) => a + b, 0) / tempsF.length,
        rangeF: Math.max(...tempsF) - Math.min(...tempsF)
    };
}

// UI update function (condensed)
function updateStatisticsDisplay(data) {
    // DOM manipulation implementation omitted
    // Updates HTML elements with statistics from API
}

// Start system
document.addEventListener('DOMContentLoaded', initializeSystem);

/**
 * ========================================
 * END OF CORE RESEARCH CODE
 * ========================================
 * 
 * Omitted for brevity:
 * - UI/DOM manipulation functions
 * - Layer toggle event handlers
 * - Color interpolation helpers
 * - Export functionality
 * - Tooltip generation
 * - Chart rendering (Canvas API)
 * 
 * These are standard web development patterns.
 * See full implementation for complete code.
 */
