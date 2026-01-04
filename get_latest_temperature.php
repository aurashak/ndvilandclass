<?php
/**
 * Get Latest Temperature Observations
 * 
 * Returns the most recent temperature observation for each census tract
 * 
 * Response format:
 * {
 *   "success": true,
 *   "last_update": "2025-01-03 14:00:00",
 *   "data_count": 288,
 *   "statistics": { "min_temp": 42.1, "max_temp": 48.7, ... },
 *   "data": [ { "tract_id": "36061000100", "temperature_f": 45.5, ... } ]
 * }
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('log_errors', 1);

// ========================================
// DATABASE CONFIGURATION
// ========================================
// IMPORTANT: Replace these values with your actual database credentials
define('DB_HOST', 'localhost');
define('DB_PORT', '5432');
define('DB_NAME', 'your_database_name');
define('DB_USER', 'your_username');
define('DB_PASS', 'your_password');

// Database connection
$conn = pg_connect(sprintf(
    "host=%s port=%s dbname=%s user=%s password=%s",
    DB_HOST,
    DB_PORT,
    DB_NAME,
    DB_USER,
    DB_PASS
));

if (!$conn) {
    error_log("Database connection failed");
    http_response_code(500);
    echo json_encode(["success" => false, "error" => "Database connection failed"]);
    exit;
}

try {
    // Get latest observation time
    $lastUpdateQuery = "SELECT MAX(observed_at) as last_update FROM temperature_observations";
    $lastUpdateResult = pg_query($conn, $lastUpdateQuery);
    $lastUpdate = pg_fetch_assoc($lastUpdateResult);
    
    if (!$lastUpdate || !$lastUpdate['last_update']) {
        echo json_encode(["success" => false, "error" => "No temperature data available"]);
        exit;
    }
    
    $lastObservationTime = $lastUpdate['last_update'];
    
    // Get latest temperature for each tract (DISTINCT ON ensures one record per tract)
    $dataQuery = "
        SELECT DISTINCT ON (t.tract_id)
            t.tract_id,
            c.tract_name,
            t.temperature_f,
            t.temperature_c,
            t.humidity,
            t.heat_index,
            t.conditions,
            t.observed_at,
            c.elderly_65plus,
            t.latitude AS lat,
            t.longitude AS lon
        FROM temperature_observations t
        INNER JOIN census_tracts c ON t.tract_id = c.tract_id
        ORDER BY t.tract_id, t.observed_at DESC
    ";
    
    $result = pg_query($conn, $dataQuery);
    
    if (!$result) {
        throw new Exception("Query failed: " . pg_last_error($conn));
    }
    
    $data = [];
    while ($row = pg_fetch_assoc($result)) {
        $data[] = [
            'tract_id' => $row['tract_id'],
            'tract_name' => $row['tract_name'],
            'temperature_f' => (float)$row['temperature_f'],
            'temperature_c' => (float)$row['temperature_c'],
            'humidity' => (int)$row['humidity'],
            'heat_index' => (float)$row['heat_index'],
            'conditions' => $row['conditions'],
            'observed_at' => $row['observed_at'],
            'elderly_65plus' => (int)$row['elderly_65plus'],
            'lat' => (float)$row['lat'],
            'lon' => (float)$row['lon']
        ];
    }
    
    // Calculate statistics
    $temps = array_column($data, 'temperature_f');
    $heatIndices = array_column($data, 'heat_index');
    
    $stats = [
        'min_temp' => !empty($temps) ? min($temps) : null,
        'max_temp' => !empty($temps) ? max($temps) : null,
        'avg_temp' => !empty($temps) ? array_sum($temps) / count($temps) : null,
        'avg_heat_index' => !empty($heatIndices) ? array_sum($heatIndices) / count($heatIndices) : null,
        'total_tracts' => count($data)
    ];
    
    echo json_encode([
        'success' => true,
        'last_update' => $lastObservationTime,
        'data_count' => count($data),
        'statistics' => $stats,
        'data' => $data
    ], JSON_PRETTY_PRINT);
    
} catch (Exception $e) {
    error_log("Error in get_latest_temperatures.php: " . $e->getMessage());
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => 'Internal server error: ' . $e->getMessage()
    ]);
}

pg_close($conn);
?>
