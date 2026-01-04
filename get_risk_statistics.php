<?php
/**
 * Get Risk Statistics and Cumulative Analysis
 * 
 * Returns comprehensive risk assessment including:
 * - Historic baseline (mean/stdDev for z-score calculations)
 * - Current risk classifications (heat/cold deviation and vulnerability)
 * - Cumulative patterns (persistent hot/cold spots over time)
 * - Tract-level statistics for mapping
 * 
 * FILTERING: Only includes residential census tracts (elderly_65plus > 0)
 * This excludes commercial/industrial areas (parks, business districts, etc.)
 * 
 * Response format: See documentation for complete JSON structure
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

// ========================================
// DATABASE CONFIGURATION
// ========================================
// IMPORTANT: Replace these values with your actual database credentials
define('DB_HOST', 'localhost');
define('DB_PORT', '5432');
define('DB_NAME', 'your_database_name');
define('DB_USER', 'your_username');
define('DB_PASS', 'your_password');

try {
    $pdo = new PDO(
        sprintf("pgsql:host=%s;port=%s;dbname=%s", DB_HOST, DB_PORT, DB_NAME),
        DB_USER,
        DB_PASS
    );
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    
    // ========================================
    // 1. GET LATEST COLLECTION TIMESTAMP
    // ========================================
    
    $stmt = $pdo->query("
        SELECT MAX(t.observed_at) as latest_time
        FROM temperature_observations t
        INNER JOIN census_tracts c ON t.tract_id = c.tract_id
        WHERE c.tract_id LIKE '36061%'
        AND c.elderly_65plus > 0
    ");
    $latestRow = $stmt->fetch(PDO::FETCH_ASSOC);
    $latestTime = $latestRow['latest_time'];
    
    if (!$latestTime) {
        echo json_encode([
            'success' => false,
            'error' => 'No temperature data available'
        ]);
        exit;
    }
    
    // ========================================
    // 2. GET HISTORIC BASELINE (ALL-TIME) - RESIDENTIAL ONLY
    // ========================================
    // This is the CRITICAL baseline for all z-score calculations
    
    $stmt = $pdo->query("
        SELECT 
            AVG(t.temperature_f) as avg_temp,
            STDDEV(t.temperature_f) as stddev_temp
        FROM temperature_observations t
        INNER JOIN census_tracts c ON t.tract_id = c.tract_id
        WHERE c.tract_id LIKE '36061%'
        AND c.elderly_65plus > 0
    ");
    $baseline = $stmt->fetch(PDO::FETCH_ASSOC);
    $historicMean = floatval($baseline['avg_temp']);
    $historicStdDev = floatval($baseline['stddev_temp']);
    
    error_log("Historic Baseline (Residential): mean={$historicMean}°F, stddev={$historicStdDev}°F");
    
    // ========================================
    // 3. GET CURRENT TEMPERATURE DISTRIBUTION - RESIDENTIAL ONLY
    // ========================================
    
    $stmt = $pdo->prepare("
        SELECT 
            t.tract_id,
            t.temperature_f,
            c.elderly_65plus as elderly_count,
            c.tract_name
        FROM temperature_observations t
        INNER JOIN census_tracts c ON t.tract_id = c.tract_id
        WHERE t.observed_at >= :latest_time::timestamp - interval '1 minute'
        AND t.observed_at <= :latest_time::timestamp + interval '1 minute'
        AND c.tract_id LIKE '36061%'
        AND c.elderly_65plus > 0
    ");
    $stmt->execute(['latest_time' => $latestTime]);
    $currentData = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    // Calculate current statistics
    $temperatures = array_column($currentData, 'temperature_f');
    $mean = array_sum($temperatures) / count($temperatures);
    
    $squaredDiffs = array_map(function($temp) use ($mean) {
        return pow($temp - $mean, 2);
    }, $temperatures);
    $variance = array_sum($squaredDiffs) / count($squaredDiffs);
    $stdDev = sqrt($variance);
    
    $minTemp = min($temperatures);
    $maxTemp = max($temperatures);
    
    // ========================================
    // 4. CLASSIFY CURRENT TRACTS (USING HISTORIC BASELINE)
    // ========================================
    // Implements the 60/40 composite risk algorithm
    
    $heatDeviation = [
        'extreme' => ['count' => 0, 'elderly' => 0],
        'very_high' => ['count' => 0, 'elderly' => 0],
        'high' => ['count' => 0, 'elderly' => 0],
        'elevated' => ['count' => 0, 'elderly' => 0]
    ];
    
    $coldDeviation = [
        'extreme' => ['count' => 0, 'elderly' => 0],
        'very_high' => ['count' => 0, 'elderly' => 0],
        'high' => ['count' => 0, 'elderly' => 0],
        'elevated' => ['count' => 0, 'elderly' => 0]
    ];
    
    $heatVulnerability = [
        'extreme' => ['count' => 0, 'elderly' => 0],
        'very_high' => ['count' => 0, 'elderly' => 0],
        'high' => ['count' => 0, 'elderly' => 0],
        'elevated' => ['count' => 0, 'elderly' => 0]
    ];
    
    $coldVulnerability = [
        'extreme' => ['count' => 0, 'elderly' => 0],
        'very_high' => ['count' => 0, 'elderly' => 0],
        'high' => ['count' => 0, 'elderly' => 0],
        'elevated' => ['count' => 0, 'elderly' => 0]
    ];
    
    $maxElderly = max(array_column($currentData, 'elderly_count'));
    
    foreach ($currentData as $tract) {
        $temp = floatval($tract['temperature_f']);
        $elderly = intval($tract['elderly_count']);
        
        // Calculate z-score using HISTORIC baseline
        $zScore = ($historicStdDev > 0) ? ($temp - $historicMean) / $historicStdDev : 0;
        $elderlyScore = ($maxElderly > 0) ? $elderly / $maxElderly : 0;
        
        // HEAT DEVIATION (temperature only, no demographics)
        if ($zScore >= 0.5) {
            if ($zScore >= 2.0) {
                $heatDeviation['extreme']['count']++;
                $heatDeviation['extreme']['elderly'] += $elderly;
            } elseif ($zScore >= 1.5) {
                $heatDeviation['very_high']['count']++;
                $heatDeviation['very_high']['elderly'] += $elderly;
            } elseif ($zScore >= 1.0) {
                $heatDeviation['high']['count']++;
                $heatDeviation['high']['elderly'] += $elderly;
            } elseif ($zScore >= 0.5) {
                $heatDeviation['elevated']['count']++;
                $heatDeviation['elevated']['elderly'] += $elderly;
            }
            
            // HEAT VULNERABILITY (composite: 60% temperature + 40% elderly)
            $riskScore = ($zScore * 0.6) + ($elderlyScore * 0.4);
            
            if ($riskScore >= 1.5) {
                $heatVulnerability['extreme']['count']++;
                $heatVulnerability['extreme']['elderly'] += $elderly;
            } elseif ($riskScore >= 1.2) {
                $heatVulnerability['very_high']['count']++;
                $heatVulnerability['very_high']['elderly'] += $elderly;
            } elseif ($riskScore >= 0.9) {
                $heatVulnerability['high']['count']++;
                $heatVulnerability['high']['elderly'] += $elderly;
            } elseif ($riskScore >= 0.5) {
                $heatVulnerability['elevated']['count']++;
                $heatVulnerability['elevated']['elderly'] += $elderly;
            }
        }
        
        // COLD DEVIATION (temperature only, no demographics)
        if ($zScore <= -0.5) {
            $absZScore = abs($zScore);
            
            if ($absZScore >= 2.0) {
                $coldDeviation['extreme']['count']++;
                $coldDeviation['extreme']['elderly'] += $elderly;
            } elseif ($absZScore >= 1.5) {
                $coldDeviation['very_high']['count']++;
                $coldDeviation['very_high']['elderly'] += $elderly;
            } elseif ($absZScore >= 1.0) {
                $coldDeviation['high']['count']++;
                $coldDeviation['high']['elderly'] += $elderly;
            } elseif ($absZScore >= 0.5) {
                $coldDeviation['elevated']['count']++;
                $coldDeviation['elevated']['elderly'] += $elderly;
            }
            
            // COLD VULNERABILITY (composite: 60% |z-score| + 40% elderly)
            $riskScore = ($absZScore * 0.6) + ($elderlyScore * 0.4);
            
            if ($riskScore >= 1.5) {
                $coldVulnerability['extreme']['count']++;
                $coldVulnerability['extreme']['elderly'] += $elderly;
            } elseif ($riskScore >= 1.2) {
                $coldVulnerability['very_high']['count']++;
                $coldVulnerability['very_high']['elderly'] += $elderly;
            } elseif ($riskScore >= 0.9) {
                $coldVulnerability['high']['count']++;
                $coldVulnerability['high']['elderly'] += $elderly;
            } elseif ($riskScore >= 0.5) {
                $coldVulnerability['elevated']['count']++;
                $coldVulnerability['elevated']['elderly'] += $elderly;
            }
        }
    }
    
    // ========================================
    // 5. GET TRACT-LEVEL CUMULATIVE DATA - RESIDENTIAL ONLY
    // ========================================
    // Historical patterns: average z-scores and frequency of extreme temps
    
    $stmt = $pdo->query("
        SELECT 
            t.tract_id,
            c.tract_name,
            c.elderly_65plus,
            COUNT(*) as total_observations,
            AVG(t.temperature_f) as avg_temp,
            MAX(t.temperature_f) as max_temp,
            MIN(t.temperature_f) as min_temp,
            
            -- Cumulative heat risk score (average z-score when hot)
            AVG(CASE 
                WHEN (t.temperature_f - $historicMean) / NULLIF($historicStdDev, 0) >= 0.5 
                THEN (t.temperature_f - $historicMean) / NULLIF($historicStdDev, 0)
                ELSE 0 
            END) as cumulative_heat_risk,
            
            -- Cumulative cold risk score (average absolute z-score when cold)
            AVG(CASE 
                WHEN (t.temperature_f - $historicMean) / NULLIF($historicStdDev, 0) <= -0.5 
                THEN ABS((t.temperature_f - $historicMean) / NULLIF($historicStdDev, 0))
                ELSE 0 
            END) as cumulative_cold_risk,
            
            -- Heat frequency (% of observations above +0.5σ)
            COUNT(CASE WHEN (t.temperature_f - $historicMean) / NULLIF($historicStdDev, 0) >= 0.5 THEN 1 END)::float / NULLIF(COUNT(*), 0) as heat_frequency,
            
            -- Cold frequency (% of observations below -0.5σ)
            COUNT(CASE WHEN (t.temperature_f - $historicMean) / NULLIF($historicStdDev, 0) <= -0.5 THEN 1 END)::float / NULLIF(COUNT(*), 0) as cold_frequency
            
        FROM temperature_observations t
        INNER JOIN census_tracts c ON t.tract_id = c.tract_id
        WHERE c.tract_id LIKE '36061%'
        AND c.elderly_65plus > 0
        GROUP BY t.tract_id, c.tract_name, c.elderly_65plus
        HAVING COUNT(*) >= 10
        ORDER BY t.tract_id
    ");
    
    $tractCumulativeData = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    // ========================================
    // 6. AGGREGATE CUMULATIVE STATISTICS - RESIDENTIAL ONLY
    // ========================================
    // Count how many tracts fall into each persistent risk category
    
    // Cumulative heat statistics
    $stmt = $pdo->query("
        SELECT 
            COUNT(CASE WHEN cumulative_heat_risk >= 2.0 THEN 1 END) as extreme_tracts,
            SUM(CASE WHEN cumulative_heat_risk >= 2.0 THEN elderly_65plus ELSE 0 END) as extreme_elderly,
            
            COUNT(CASE WHEN cumulative_heat_risk >= 1.5 AND cumulative_heat_risk < 2.0 THEN 1 END) as veryhigh_tracts,
            SUM(CASE WHEN cumulative_heat_risk >= 1.5 AND cumulative_heat_risk < 2.0 THEN elderly_65plus ELSE 0 END) as veryhigh_elderly,
            
            COUNT(CASE WHEN cumulative_heat_risk >= 1.0 AND cumulative_heat_risk < 1.5 THEN 1 END) as high_tracts,
            SUM(CASE WHEN cumulative_heat_risk >= 1.0 AND cumulative_heat_risk < 1.5 THEN elderly_65plus ELSE 0 END) as high_elderly,
            
            COUNT(CASE WHEN cumulative_heat_risk >= 0.5 AND cumulative_heat_risk < 1.0 THEN 1 END) as elevated_tracts,
            SUM(CASE WHEN cumulative_heat_risk >= 0.5 AND cumulative_heat_risk < 1.0 THEN elderly_65plus ELSE 0 END) as elevated_elderly
        FROM (
            SELECT 
                t.tract_id,
                c.elderly_65plus,
                AVG(CASE 
                    WHEN (t.temperature_f - $historicMean) / NULLIF($historicStdDev, 0) >= 0.5 
                    THEN (t.temperature_f - $historicMean) / NULLIF($historicStdDev, 0)
                    ELSE 0 
                END) as cumulative_heat_risk
            FROM temperature_observations t
            INNER JOIN census_tracts c ON t.tract_id = c.tract_id
            WHERE c.tract_id LIKE '36061%'
            AND c.elderly_65plus > 0
            GROUP BY t.tract_id, c.elderly_65plus
            HAVING COUNT(*) >= 10
        ) heat_stats
    ");
    $cumulativeHeatStats = $stmt->fetch(PDO::FETCH_ASSOC);
    
    // Cumulative cold statistics
    $stmt = $pdo->query("
        SELECT 
            COUNT(CASE WHEN cumulative_cold_risk >= 2.0 THEN 1 END) as extreme_tracts,
            SUM(CASE WHEN cumulative_cold_risk >= 2.0 THEN elderly_65plus ELSE 0 END) as extreme_elderly,
            
            COUNT(CASE WHEN cumulative_cold_risk >= 1.5 AND cumulative_cold_risk < 2.0 THEN 1 END) as veryhigh_tracts,
            SUM(CASE WHEN cumulative_cold_risk >= 1.5 AND cumulative_cold_risk < 2.0 THEN elderly_65plus ELSE 0 END) as veryhigh_elderly,
            
            COUNT(CASE WHEN cumulative_cold_risk >= 1.0 AND cumulative_cold_risk < 1.5 THEN 1 END) as high_tracts,
            SUM(CASE WHEN cumulative_cold_risk >= 1.0 AND cumulative_cold_risk < 1.5 THEN elderly_65plus ELSE 0 END) as high_elderly,
            
            COUNT(CASE WHEN cumulative_cold_risk >= 0.5 AND cumulative_cold_risk < 1.0 THEN 1 END) as elevated_tracts,
            SUM(CASE WHEN cumulative_cold_risk >= 0.5 AND cumulative_cold_risk < 1.0 THEN elderly_65plus ELSE 0 END) as elevated_elderly
        FROM (
            SELECT 
                t.tract_id,
                c.elderly_65plus,
                AVG(CASE 
                    WHEN (t.temperature_f - $historicMean) / NULLIF($historicStdDev, 0) <= -0.5 
                    THEN ABS((t.temperature_f - $historicMean) / NULLIF($historicStdDev, 0))
                    ELSE 0 
                END) as cumulative_cold_risk
            FROM temperature_observations t
            INNER JOIN census_tracts c ON t.tract_id = c.tract_id
            WHERE c.tract_id LIKE '36061%'
            AND c.elderly_65plus > 0
            GROUP BY t.tract_id, c.elderly_65plus
            HAVING COUNT(*) >= 10
        ) cold_stats
    ");
    $cumulativeColdStats = $stmt->fetch(PDO::FETCH_ASSOC);
    
    // ========================================
    // 7. GET OVERALL STATISTICS
    // ========================================
    
    $stmt = $pdo->query("
        SELECT 
            COUNT(*) as total_observations,
            COUNT(DISTINCT t.tract_id) as total_tracts,
            MIN(t.observed_at) as data_start,
            MAX(t.observed_at) as data_end
        FROM temperature_observations t
        INNER JOIN census_tracts c ON t.tract_id = c.tract_id
        WHERE c.tract_id LIKE '36061%'
    ");
    $overall = $stmt->fetch(PDO::FETCH_ASSOC);
    
    // Get separate counts for all tracts vs residential
    $stmt = $pdo->query("
        SELECT 
            COUNT(*) as total_tracts_all,
            COUNT(CASE WHEN elderly_65plus > 0 THEN 1 END) as total_tracts_residential,
            SUM(elderly_65plus) as total_elderly
        FROM census_tracts
        WHERE tract_id LIKE '36061%'
    ");
    $demographics = $stmt->fetch(PDO::FETCH_ASSOC);
    
    // ========================================
    // 8. GET ALL-TIME TEMPERATURE EXTREMES - RESIDENTIAL ONLY
    // ========================================
    
    $stmt = $pdo->query("
        SELECT 
            MAX(t.temperature_f) as all_time_max_temp,
            MIN(t.temperature_f) as all_time_min_temp
        FROM temperature_observations t
        INNER JOIN census_tracts c ON t.tract_id = c.tract_id
        WHERE c.tract_id LIKE '36061%'
        AND c.elderly_65plus > 0
    ");
    $allTimeExtremes = $stmt->fetch(PDO::FETCH_ASSOC);
    
    // Get tract info for all-time max (residential only)
    $stmt = $pdo->query("
        SELECT t.tract_id, t.temperature_f, t.observed_at
        FROM temperature_observations t
        INNER JOIN census_tracts c ON t.tract_id = c.tract_id
        WHERE t.temperature_f = (
            SELECT MAX(temp.temperature_f) 
            FROM temperature_observations temp
            INNER JOIN census_tracts ct ON temp.tract_id = ct.tract_id
            WHERE ct.tract_id LIKE '36061%'
            AND ct.elderly_65plus > 0
        )
        AND c.tract_id LIKE '36061%'
        AND c.elderly_65plus > 0
        LIMIT 1
    ");
    $allTimeHottestTract = $stmt->fetch(PDO::FETCH_ASSOC);
    
    // Get tract info for all-time min (residential only)
    $stmt = $pdo->query("
        SELECT t.tract_id, t.temperature_f, t.observed_at
        FROM temperature_observations t
        INNER JOIN census_tracts c ON t.tract_id = c.tract_id
        WHERE t.temperature_f = (
            SELECT MIN(temp.temperature_f) 
            FROM temperature_observations temp
            INNER JOIN census_tracts ct ON temp.tract_id = ct.tract_id
            WHERE ct.tract_id LIKE '36061%'
            AND ct.elderly_65plus > 0
        )
        AND c.tract_id LIKE '36061%'
        AND c.elderly_65plus > 0
        LIMIT 1
    ");
    $allTimeColdestTract = $stmt->fetch(PDO::FETCH_ASSOC);
    
    // ========================================
    // 9. GET CURRENT EXTREME TRACTS - RESIDENTIAL ONLY
    // ========================================
    
    $stmt = $pdo->prepare("
        SELECT 
            c.tract_id,
            c.tract_name as name,
            t.temperature_f as temp
        FROM temperature_observations t
        INNER JOIN census_tracts c ON t.tract_id = c.tract_id
        WHERE t.observed_at >= :latest_time::timestamp - interval '1 minute'
        AND t.observed_at <= :latest_time::timestamp + interval '1 minute'
        AND c.tract_id LIKE '36061%'
        AND c.elderly_65plus > 0
        ORDER BY t.temperature_f DESC
        LIMIT 1
    ");
    $stmt->execute(['latest_time' => $latestTime]);
    $hottest = $stmt->fetch(PDO::FETCH_ASSOC);
    
    $stmt = $pdo->prepare("
        SELECT 
            c.tract_id,
            c.tract_name as name,
            t.temperature_f as temp
        FROM temperature_observations t
        INNER JOIN census_tracts c ON t.tract_id = c.tract_id
        WHERE t.observed_at >= :latest_time::timestamp - interval '1 minute'
        AND t.observed_at <= :latest_time::timestamp + interval '1 minute'
        AND c.tract_id LIKE '36061%'
        AND c.elderly_65plus > 0
        ORDER BY t.temperature_f ASC
        LIMIT 1
    ");
    $stmt->execute(['latest_time' => $latestTime]);
    $coldest = $stmt->fetch(PDO::FETCH_ASSOC);
    
    // ========================================
    // 10. RETURN JSON RESPONSE
    // ========================================
    
    echo json_encode([
        'success' => true,
        'timestamp' => $latestTime,
        'analysis_type' => 'standard_deviation_residential_only',
        
        'current_stats' => [
            'mean_temp' => round($mean, 2),
            'std_dev' => round($stdDev, 2),
            'min_temp' => round($minTemp, 2),
            'max_temp' => round($maxTemp, 2),
            'threshold_2sd_hot' => round($mean + 2 * $stdDev, 2),
            'threshold_2sd_cold' => round($mean - 2 * $stdDev, 2),
            'note' => 'Current snapshot statistics (residential tracts only)'
        ],
        
        'historic_baseline' => [
            'mean' => round($historicMean, 2),
            'stddev' => round($historicStdDev, 2),
            'threshold_2sd_hot' => round($historicMean + 2 * $historicStdDev, 2),
            'threshold_2sd_cold' => round($historicMean - 2 * $historicStdDev, 2),
            'note' => 'All risk categories calculated using residential tracts only'
        ],
        
        'all_time_extremes' => [
            'max_temp' => round($allTimeExtremes['all_time_max_temp'], 2),
            'min_temp' => round($allTimeExtremes['all_time_min_temp'], 2),
            'range' => round($allTimeExtremes['all_time_max_temp'] - $allTimeExtremes['all_time_min_temp'], 2),
            'hottest_tract_id' => $allTimeHottestTract['tract_id'],
            'hottest_tract_temp' => round($allTimeHottestTract['temperature_f'], 2),
            'coldest_tract_id' => $allTimeColdestTract['tract_id'],
            'coldest_tract_temp' => round($allTimeColdestTract['temperature_f'], 2)
        ],
        
        'heat_deviation' => [
            'extreme_count' => $heatDeviation['extreme']['count'],
            'extreme_elderly' => $heatDeviation['extreme']['elderly'],
            'very_high_count' => $heatDeviation['very_high']['count'],
            'very_high_elderly' => $heatDeviation['very_high']['elderly'],
            'high_count' => $heatDeviation['high']['count'],
            'high_elderly' => $heatDeviation['high']['elderly'],
            'elevated_count' => $heatDeviation['elevated']['count'],
            'elevated_elderly' => $heatDeviation['elevated']['elderly']
        ],
        
        'cold_deviation' => [
            'extreme_count' => $coldDeviation['extreme']['count'],
            'extreme_elderly' => $coldDeviation['extreme']['elderly'],
            'very_high_count' => $coldDeviation['very_high']['count'],
            'very_high_elderly' => $coldDeviation['very_high']['elderly'],
            'high_count' => $coldDeviation['high']['count'],
            'high_elderly' => $coldDeviation['high']['elderly'],
            'elevated_count' => $coldDeviation['elevated']['count'],
            'elevated_elderly' => $coldDeviation['elevated']['elderly']
        ],
        
        'heat_vulnerability' => [
            'extreme_count' => $heatVulnerability['extreme']['count'],
            'extreme_elderly' => $heatVulnerability['extreme']['elderly'],
            'very_high_count' => $heatVulnerability['very_high']['count'],
            'very_high_elderly' => $heatVulnerability['very_high']['elderly'],
            'high_count' => $heatVulnerability['high']['count'],
            'high_elderly' => $heatVulnerability['high']['elderly'],
            'elevated_count' => $heatVulnerability['elevated']['count'],
            'elevated_elderly' => $heatVulnerability['elevated']['elderly']
        ],
        
        'cold_vulnerability' => [
            'extreme_count' => $coldVulnerability['extreme']['count'],
            'extreme_elderly' => $coldVulnerability['extreme']['elderly'],
            'very_high_count' => $coldVulnerability['very_high']['count'],
            'very_high_elderly' => $coldVulnerability['very_high']['elderly'],
            'high_count' => $coldVulnerability['high']['count'],
            'high_elderly' => $coldVulnerability['high']['elderly'],
            'elevated_count' => $coldVulnerability['elevated']['count'],
            'elevated_elderly' => $coldVulnerability['elevated']['elderly']
        ],
        
        'cumulative_heat_stats' => [
            'extreme_tracts' => intval($cumulativeHeatStats['extreme_tracts'] ?? 0),
            'extreme_elderly' => intval($cumulativeHeatStats['extreme_elderly'] ?? 0),
            'veryhigh_tracts' => intval($cumulativeHeatStats['veryhigh_tracts'] ?? 0),
            'veryhigh_elderly' => intval($cumulativeHeatStats['veryhigh_elderly'] ?? 0),
            'high_tracts' => intval($cumulativeHeatStats['high_tracts'] ?? 0),
            'high_elderly' => intval($cumulativeHeatStats['high_elderly'] ?? 0),
            'elevated_tracts' => intval($cumulativeHeatStats['elevated_tracts'] ?? 0),
            'elevated_elderly' => intval($cumulativeHeatStats['elevated_elderly'] ?? 0)
        ],
        
        'cumulative_cold_stats' => [
            'extreme_tracts' => intval($cumulativeColdStats['extreme_tracts'] ?? 0),
            'extreme_elderly' => intval($cumulativeColdStats['extreme_elderly'] ?? 0),
            'veryhigh_tracts' => intval($cumulativeColdStats['veryhigh_tracts'] ?? 0),
            'veryhigh_elderly' => intval($cumulativeColdStats['veryhigh_elderly'] ?? 0),
            'high_tracts' => intval($cumulativeColdStats['high_tracts'] ?? 0),
            'high_elderly' => intval($cumulativeColdStats['high_elderly'] ?? 0),
            'elevated_tracts' => intval($cumulativeColdStats['elevated_tracts'] ?? 0),
            'elevated_elderly' => intval($cumulativeColdStats['elevated_elderly'] ?? 0)
        ],
        
        'overall' => [
            'total_observations' => intval($overall['total_observations']),
            'total_tracts' => intval($overall['total_tracts']),
            'total_tracts_all' => intval($demographics['total_tracts_all']),
            'total_tracts_residential' => intval($demographics['total_tracts_residential']),
            'total_elderly' => intval($demographics['total_elderly']),
            'data_start' => $overall['data_start'],
            'data_end' => $overall['data_end']
        ],
        
        'global_averages' => [
            'temperature' => round($historicMean, 2),
            'stddev_temp' => round($historicStdDev, 2)
        ],
        
        'hottest_tract' => [
            'tract_id' => $hottest['tract_id'],
            'name' => $hottest['name'],
            'temp' => round($hottest['temp'], 2)
        ],
        
        'coldest_tract' => [
            'tract_id' => $coldest['tract_id'],
            'name' => $coldest['name'],
            'temp' => round($coldest['temp'], 2)
        ],
        
        'tracts' => $tractCumulativeData
    ]);
    
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => 'Database error: ' . $e->getMessage()
    ]);
}
?>
