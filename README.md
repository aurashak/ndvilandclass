Urban Heat/Cold Vulnerability Assessment System

Real-time temperature monitoring and vulnerability analysis for census tract-level climate adaptation

Full Research Paper: https://docs.google.com/document/d/1egRGpli74ZPty9MTS-Wo6o1eF_GddCST2JqV74wU8Ug/edit?usp=sharing

Overview

This system provides real-time assessment of heat and cold vulnerability across Manhattan's 288 census tracts by combining temperature monitoring (3x daily), demographic data (elderly population 65+), and statistical analysis (z-score deviation detection).

Research Contributions:
1. Z-score based deviation detection using historic baseline (mean/stdDev from cumulative observations)
2. Composite vulnerability metric weighted 60% temperature deviation, 40% elderly population
3. Multi-threshold risk classification: Extreme (1.5σ), Very High (1.2σ), High (0.9σ), Elevated (0.5σ)
4. Cumulative risk pattern analysis identifying persistent hot/cold spots over time

Core Algorithm

Vulnerability Risk Score:

Z-score normalization: Z = (current_temp - historic_mean) / historic_stdDev
Normalize elderly population: E = tract_elderly_count / max_elderly_count
Composite risk score: Risk = (Z × 0.6) + (E × 0.4)

Risk Classification:

Extreme: Score ≥ 1.5 (95th+ percentile) - Dark Red/Dark Blue
Very High: Score 1.2-1.5 (85th-95th percentile) - Orange Red/Medium Blue
High: Score 0.9-1.2 (75th-85th percentile) - Orange/Royal Blue
Elevated: Score 0.5-0.9 (65th-75th percentile) - Gold/Sky Blue

Heat layers only display tracts with Z ≥ +0.5σ (above-average temperatures). Cold layers only display tracts with Z ≤ -0.5σ (below-average temperatures).

System Architecture

Data Collection Layer: OpenWeather API → PHP Cron Job → MySQL Database

API Layer: get_latest_temperatures.php (current observations) and get_risk_statistics.php (statistics & baseline)

Visualization Layer: tempage.js → Risk Layers → Leaflet.js Map

Repository Structure

urban-temperature-vulnerability/
- README.md (this file)
- index.html (web application interface)
- tempage.js (core algorithms - academic version)
- get_latest_temperatures.php (API endpoint for current observations)
- get_risk_statistics.php (API endpoint for statistics and baseline)
- 2020tractsage_with_age.geojson (census tracts with demographics)

Quick Start

Prerequisites: Web server (Apache/Nginx), PHP 7.4+, MySQL 5.7+, OpenWeatherMap API key

Setup:
1. Configure database connection in PHP files (update credentials)
2. Load GeoJSON in tempage.js (census tract boundaries)
3. Open index.html in web browser
4. Toggle layers to view different risk assessments

API Endpoints

1. Get Latest Temperatures

GET get_latest_temperatures.php

Returns: Current temperature observations for all 288 census tracts

Response format: JSON object with success flag, data_count (288), last_update timestamp, and data array containing tract_id, tract_name, temperature_f, temperature_c, humidity, conditions, elderly_65plus, observed_at, and other fields for each census tract.

2. Get Risk Statistics

GET get_risk_statistics.php

Returns: Historic baseline, cumulative statistics, vulnerability counts

Response format: JSON object with success flag, global_averages (temperature and stddev_temp - used for z-score calculations), heat_vulnerability (extreme_count, extreme_elderly, very_high_count, etc.), cold_vulnerability (same structure), cumulative_heat_stats and cumulative_cold_stats (persistent pattern analysis), and tracts array with cumulative_heat_risk (average z-score), heat_frequency (proportion of time above +0.5σ), cumulative_cold_risk, and cold_frequency for each tract.

Key fields: global_averages.temperature is the historic mean used for z-score calculations. global_averages.stddev_temp is the historic standard deviation used for z-score calculations. cumulative_heat_risk is the average z-score for hot observations (frequency-weighted). heat_frequency is the proportion of observations where tract was above +0.5σ.

Study Details

Location: Manhattan, NYC (288 census tracts)
Data Collection: 3x daily at 6am, 2pm, 10pm EST
Temperature Source: OpenWeatherMap API
Demographic Source: US Census 2020 (ACS 5-Year Estimates)
Population Focus: Adults aged 65+ (vulnerable demographic)
Spatial Resolution: Census tract level (approximately 4,000 residents per tract)
Temporal Resolution: 3 observations per day (8-hour intervals)

Technical Notes

JavaScript (tempage.js): Calls get_latest_temperatures.php for current data. Calls get_risk_statistics.php for historic baseline and cumulative stats. Implements vulnerability scoring algorithm (60/40 weighting). Renders risk layers using Leaflet.js.

PHP Files: Sanitized for public release (database credentials removed). Configure database connection before deployment. Requires MySQL database with temperature observations table.

Data Quality: Outlier detection applied. Geographic boundary checking performed. Missing data handling implemented.

Citation

If you use this system in your research, please cite:

@article{yourname2025temperature,
  title={Urban Heat and Cold Vulnerability Assessment Using Real-Time Temperature Monitoring},
  author={Your Name},
  journal={Journal Name},
  year={2025},
  doi={YOUR_DOI}
}

Full Research Paper: INSERT_LINK_TO_PUBLISHED_PAPER_OR_PREPRINT

Contact

Last Updated: January 2026
