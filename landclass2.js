document.addEventListener("DOMContentLoaded", () => {
    const MIN_ZOOM = 12, MAX_ZOOM = 15, DEFAULT_ZOOM = 13;
    const DEFAULT_CENTER = [33.7490, -84.3880];

    const map2018 = L.map("map2018", { minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    const map2024 = L.map("map2024", { minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    const locationSearch = document.getElementById('locationSearch');
    const searchResults = document.getElementById('searchResults');
    let searchTimeout;

    async function searchLocation(query) {
        if (query.length < 3) {
            searchResults.classList.remove('active');
            return;
        }

        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`);
            const results = await response.json();
            displaySearchResults(results);
        } catch (error) {
            console.error('Search error:', error);
        }
    }

    function displaySearchResults(results) {
        if (results.length === 0) {
            searchResults.innerHTML = '<div class="search-result-item">No results found</div>';
            searchResults.classList.add('active');
            return;
        }

        searchResults.innerHTML = results.map(result => {
            const name = result.display_name.split(',')[0];
            const details = result.display_name.split(',').slice(1).join(',').trim();
            
            return `
                <div class="search-result-item" data-lat="${result.lat}" data-lon="${result.lon}">
                    <div class="search-result-name">${name}</div>
                    <div class="search-result-details">${details}</div>
                </div>
            `;
        }).join('');

        searchResults.classList.add('active');

        searchResults.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', () => {
                const lat = parseFloat(item.dataset.lat);
                const lon = parseFloat(item.dataset.lon);
                
                map2018.setView([lat, lon], DEFAULT_ZOOM);
                map2024.setView([lat, lon], DEFAULT_ZOOM);
                
                locationSearch.value = item.querySelector('.search-result-name').textContent;
                searchResults.classList.remove('active');
            });
        });
    }

    locationSearch.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => searchLocation(e.target.value), 300);
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-wrapper')) {
            searchResults.classList.remove('active');
        }
    });

    let syncInProgress = false;
    function syncMaps(source, target) {
        if (!syncInProgress) {
            syncInProgress = true;
            target.setView(source.getCenter(), source.getZoom(), { animate: false });
            setTimeout(() => (syncInProgress = false), 100);
        }
    }
    map2018.on("moveend", () => syncMaps(map2018, map2024));
    map2024.on("moveend", () => syncMaps(map2024, map2018));

    const osmOpts = { attribution: "© OpenStreetMap", opacity: 0.4 };
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", osmOpts).addTo(map2018);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", osmOpts).addTo(map2024);

    const s2Opts = { attribution: "Sentinel-2 by EOX", opacity: 0.9, maxZoom: MAX_ZOOM };
    L.tileLayer("https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2018_3857/default/g/{z}/{y}/{x}.jpg", s2Opts).addTo(map2018);
    L.tileLayer("https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2022_3857/default/g/{z}/{y}/{x}.jpg", s2Opts).addTo(map2024);

    const labelOpts = { 
        attribution: "© OpenStreetMap", 
        opacity: 0.8,
        maxZoom: MAX_ZOOM 
    };

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png", labelOpts).addTo(map2018);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png", labelOpts).addTo(map2024);

    const classifyBtn = document.getElementById("classifyBtn");
    const resultsDiv = document.getElementById("resultsPanel");
    const loadingDiv = document.getElementById("loadingIndicator");

    function updateLoadingProgress(percent) {
        const progressBar = document.querySelector('.loading-progress');
        const percentageText = document.querySelector('.loading-percentage');
        
        if (progressBar) progressBar.style.width = `${percent}%`;
        if (percentageText) percentageText.textContent = `${Math.round(percent)}%`;
    }

    classifyBtn.addEventListener("click", async () => {
        classifyBtn.disabled = true;
        classifyBtn.classList.add('processing');
        classifyBtn.textContent = "Processing...";
        resultsDiv.style.display = "none";
        loadingDiv.classList.add('active');

        try {
            updateLoadingProgress(10);
            await new Promise(resolve => setTimeout(resolve, 300));
            
            async function captureMap(mapId) {
                const mapElement = document.getElementById(mapId);
                const controls = mapElement.querySelectorAll('.leaflet-control-container');
                controls.forEach(c => c.style.display = 'none');
                await new Promise(resolve => setTimeout(resolve, 100));
                
                const canvas = await html2canvas(mapElement, { 
                    useCORS: true,
                    allowTaint: true,
                    logging: false
                });
                
                controls.forEach(c => c.style.display = '');
                return canvas.toDataURL("image/png");
            }
            
            const screenshot2018 = await captureMap("map2018");
            const screenshot2024 = await captureMap("map2024");
            updateLoadingProgress(30);

            const bounds = map2024.getBounds();
            const center = map2024.getCenter();
            const payload = {
                north: bounds.getNorth(),
                south: bounds.getSouth(),
                east: bounds.getEast(),
                west: bounds.getWest(),
                zoom: map2024.getZoom(),
                center_lat: center.lat,
                center_lon: center.lng,
                analysis_type: "urban"
            };
            updateLoadingProgress(40);

            const response = await fetch("/api/classify-area", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error("API error:", errorText);
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            updateLoadingProgress(70);
            const result = await response.json();
            updateLoadingProgress(90);

            await new Promise(resolve => setTimeout(resolve, 200));
            updateLoadingProgress(100);

            loadingDiv.classList.remove('active');
            displayResults(result, screenshot2018, screenshot2024);
        } catch (err) {
            console.error("Analysis failed:", err);
            loadingDiv.classList.remove('active');
            resultsDiv.innerHTML = `
                <h2>Analysis Error</h2>
                <p>Error: ${err.message}</p>
                <button onclick="location.reload()">Reload Page</button>
            `;
            resultsDiv.style.display = "block";
        } finally {
            classifyBtn.disabled = false;
            classifyBtn.classList.remove('processing');
            classifyBtn.textContent = "Analyze View";
        }
    });

    function displayResults(result = {}, screenshot2018 = "", screenshot2024 = "") {
        const year2018 = result.year_2018 || {};
        const year2024 = result.year_2024 || {};
        const classImg2018 = year2018.classification_image || "";
        const classImg2024 = year2024.classification_image || "";
        const changeImg = result.change_image || "";

        resultsDiv.innerHTML = `
<div class="analysis-box">
    <h3>Land Classification Comparison</h3>
    <div class="img-slider-container">
        ${classImg2018 ? `<img src="data:image/png;base64,${classImg2018}" alt="2018 Classification" class="base-image">` : ''}
        <div class="overlay-image-wrapper">
            ${classImg2024 ? `<img src="data:image/png;base64,${classImg2024}" alt="2024 Classification" class="overlay-image">` : ''}
            <div class="slider-handle">
                <div class="knob"></div>
            </div>
        </div>
    </div>
    <div class="slider-labels">
        <span class="label-left">2018 Satellite Imagery</span>
        <span class="label-right">2024 Satellite Imagery</span>
    </div>
    
    <div class="legends-container">
        <div class="legend-box">
            <h4>Land Classes</h4>
            <div class="legend-item">
                <span class="legend-color" style="background:#0000ff;"></span>
                <span>Water</span>
            </div>
            <div class="legend-item">
                <span class="legend-color" style="background:#808080;"></span>
                <span>Bare/Urban</span>
            </div>
            <div class="legend-item">
                <span class="legend-color" style="background:#ffff80;"></span>
                <span>Sparse Vegetation</span>
            </div>
            <div class="legend-item">
                <span class="legend-color" style="background:#90ee90;"></span>
                <span>Moderate Vegetation</span>
            </div>
            <div class="legend-item">
                <span class="legend-color" style="background:#228b22;"></span>
                <span>Dense Vegetation</span>
            </div>
            <div class="legend-item">
                <span class="legend-color" style="background:#000000;"></span>
                <span>No Data/Cloud</span>
            </div>
        </div>
    </div>
</div>

<div class="analysis-box">
    <h3>Change Overlay</h3>
    <div class="img-slider-container">
        ${screenshot2024 ? `<img src="${screenshot2024}" alt="Satellite Base" class="base-image">` : ''}
        <div class="overlay-image-wrapper">
            ${changeImg ? `<img src="data:image/png;base64,${changeImg}" alt="Change Overlay" class="overlay-image">` : ''}
            <div class="slider-handle">
                <div class="knob"></div>
            </div>
        </div>
    </div>
    <div class="slider-labels">
        <span class="label-left">2024 Imagery</span>
        <span class="label-right">Change Overlay</span>
    </div>
    
    <div class="legends-container">
        <div class="legend-box">
            <h4>Changes Detection</h4>
            <div class="legend-item">
                <span class="legend-color" style="background:#ff0000;"></span>
                <span>Vegetation Loss</span>
            </div>
            <div class="legend-item">
                <span class="legend-color" style="background:#00ff00;"></span>
                <span>Vegetation Gain</span>
            </div>
            <div class="legend-item">
                <span class="legend-color" style="background:#000000;"></span>
                <span>No Data/Cloud</span>
            </div>
        </div>
    </div>
</div>

<div class="analysis-box">
    <h3>Data Summary</h3>
    <table>
        <thead>
            <tr>
                <th>Land Cover Type</th>
                <th>2018</th>
                <th>2024</th>
                <th>Change</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td>Water</td>
                <td>${year2018.water?.toFixed(2) || 0}%</td>
                <td>${year2024.water?.toFixed(2) || 0}%</td>
                <td class="${result.changes?.water > 0 ? 'positive' : result.changes?.water < 0 ? 'negative' : ''}">${result.changes?.water?.toFixed(2) || 0}%</td>
            </tr>
            <tr>
                <td>Bare/Urban</td>
                <td>${year2018.bare_urban?.toFixed(2) || 0}%</td>
                <td>${year2024.bare_urban?.toFixed(2) || 0}%</td>
                <td class="${result.changes?.bare_urban > 0 ? 'positive' : result.changes?.bare_urban < 0 ? 'negative' : ''}">${result.changes?.bare_urban?.toFixed(2) || 0}%</td>
            </tr>
            <tr>
                <td>Sparse Vegetation</td>
                <td>${year2018.sparse_veg?.toFixed(2) || 0}%</td>
                <td>${year2024.sparse_veg?.toFixed(2) || 0}%</td>
                <td class="${result.changes?.sparse_veg > 0 ? 'positive' : result.changes?.sparse_veg < 0 ? 'negative' : ''}">${result.changes?.sparse_veg?.toFixed(2) || 0}%</td>
            </tr>
            <tr>
                <td>Moderate Vegetation</td>
                <td>${year2018.moderate_veg?.toFixed(2) || 0}%</td>
                <td>${year2024.moderate_veg?.toFixed(2) || 0}%</td>
                <td class="${result.changes?.moderate_veg > 0 ? 'positive' : result.changes?.moderate_veg < 0 ? 'negative' : ''}">${result.changes?.moderate_veg?.toFixed(2) || 0}%</td>
            </tr>
            <tr>
                <td>Dense Vegetation</td>
                <td>${year2018.dense_veg?.toFixed(2) || 0}%</td>
                <td>${year2024.dense_veg?.toFixed(2) || 0}%</td>
                <td class="${result.changes?.dense_veg > 0 ? 'positive' : result.changes?.dense_veg < 0 ? 'negative' : ''}">${result.changes?.dense_veg?.toFixed(2) || 0}%</td>
            </tr>
        </tbody>
    </table>
</div>

${result.statistical_analysis ? `
<div class="analysis-box">
    <h3>Statistical Analysis</h3>
    
    ${result.statistical_analysis.summary ? `
    <div class="stats-section">
        <h4>Summary Statistics</h4>
        <table>
            <tr>
                <td>Total Pixels Analyzed</td>
                <td>${result.statistical_analysis.summary.total_valid_pixels.toLocaleString()}</td>
            </tr>
            <tr>
                <td>Pixels with Urban Gain</td>
                <td>${result.statistical_analysis.summary.pixels_with_urban_gain.toLocaleString()} (${result.statistical_analysis.summary.urban_gain_percentage.toFixed(1)}%)</td>
            </tr>
            <tr>
                <td>Overall NDVI Change</td>
                <td>${result.statistical_analysis.summary.mean_ndvi_change_all >= 0 ? '+' : ''}${result.statistical_analysis.summary.mean_ndvi_change_all.toFixed(3)}</td>
            </tr>
            <tr>
                <td>NDVI in Urban Areas</td>
                <td>${result.statistical_analysis.summary.mean_ndvi_change_urban >= 0 ? '+' : ''}${result.statistical_analysis.summary.mean_ndvi_change_urban.toFixed(3)}</td>
            </tr>
            <tr>
                <td>NDVI in Non-Urban Areas</td>
                <td>${result.statistical_analysis.summary.mean_ndvi_change_non_urban >= 0 ? '+' : ''}${result.statistical_analysis.summary.mean_ndvi_change_non_urban.toFixed(3)}</td>
            </tr>
        </table>
    </div>
    ` : ''}
    
    ${result.statistical_analysis.correlation ? `
    <div class="stats-section">
        <h4>Correlation Analysis</h4>
        <table>
            <tr>
                <td>Pearson's r</td>
                <td>${result.statistical_analysis.correlation.r.toFixed(3)}</td>
            </tr>
            <tr>
                <td>R²</td>
                <td>${result.statistical_analysis.correlation.r_squared.toFixed(3)}</td>
            </tr>
            <tr>
                <td>p-value</td>
                <td>${result.statistical_analysis.correlation.p_value < 0.001 ? '<0.001' : result.statistical_analysis.correlation.p_value.toFixed(4)}</td>
            </tr>
        </table>
        <p>R² = ${(result.statistical_analysis.correlation.r_squared * 100).toFixed(1)}%: Urban expansion explains ${(result.statistical_analysis.correlation.r_squared * 100).toFixed(1)}% of vegetation change.</p>
    </div>
    ` : ''}
    
    ${result.statistical_analysis.regression ? `
    <div class="stats-section">
        <h4>Regression Model</h4>
        <table>
            <tr>
                <td>Coefficient (β)</td>
                <td>${result.statistical_analysis.regression.coefficient.toFixed(4)}</td>
            </tr>
            <tr>
                <td>Intercept</td>
                <td>${result.statistical_analysis.regression.intercept.toFixed(4)}</td>
            </tr>
            <tr>
                <td>Equation</td>
                <td>${result.statistical_analysis.regression.equation}</td>
            </tr>
        </table>
    </div>
    ` : ''}
    
    ${result.regression_chart ? `
    <div class="chart-container">
        <img src="data:image/png;base64,${result.regression_chart}" alt="Regression Chart" class="regression-chart">
    </div>
    ` : ''}
</div>
` : ''}

<div class="methodology-notes">
    <h4>Sources & Methodology</h4>
    <p>Satellite Data: Sentinel-2 MSI provided by ESA through Copernicus Data Space Ecosystem.</p>
    <p>Classification Method: NDVI (Rouse et al., 1974)</p>
    <p>Statistical Analysis: Pearson's r correlation and linear regression</p>
</div>
        `;

        resultsDiv.style.display = "block";
        initializeSliders();
    }

    function initializeSliders() {
        const sliderContainers = document.querySelectorAll('.img-slider-container');
        
        sliderContainers.forEach(container => {
            const overlay = container.querySelector('.overlay-image');
            const handle = container.querySelector('.slider-handle');
            
            if (!overlay || !handle) return;
            
            let isDragging = false;
            
            const startDrag = (e) => {
                e.preventDefault();
                isDragging = true;
            };
            
            const stopDrag = () => {
                isDragging = false;
            };
            
            const drag = (e) => {
                if (!isDragging) return;
                
                const rect = container.getBoundingClientRect();
                const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
                let offsetX = clientX - rect.left;
                offsetX = Math.max(0, Math.min(offsetX, rect.width));
                const percent = (offsetX / rect.width) * 100;
                
                handle.style.left = `${percent}%`;
                overlay.style.clipPath = `inset(0 ${100 - percent}% 0 0)`;
            };
            
            handle.addEventListener('mousedown', startDrag);
            handle.addEventListener('touchstart', startDrag, { passive: false });
            
            document.addEventListener('mousemove', drag);
            document.addEventListener('mouseup', stopDrag);
            document.addEventListener('touchmove', drag, { passive: false });
            document.addEventListener('touchend', stopDrag);
        });
    }
});
