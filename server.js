const express = require('express');
const { exec } = require('child_process');
const fs = require('fs').promises;
const fs1 = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Store test results
const resultsDir = path.join(__dirname, 'results');
const scriptsDir = path.join(__dirname, 'k6-scripts');

// Initialize directories
async function initDirs() {
  try {
    await fs.mkdir(resultsDir, { recursive: true });
    await fs.mkdir(scriptsDir, { recursive: true });
  } catch (err) {
    console.error('Error creating directories:', err);
  }
}

initDirs();

// Generate K6 script based on test configuration
function generateK6Script(config) {
  const { url, method, headers, body, vus, duration, thresholds } = config;
  const stages = false;

  let headersStr = '';
  if (headers && Object.keys(headers).length > 0) {
    headersStr = JSON.stringify(headers, null, 2);
  } else {
    headersStr = "{ 'Content-Type': 'application/json' }";
  }

  let bodyStr = body ? JSON.stringify(body) : 'null';
  
  if(!thresholds.errorRate) thresholds.errorRate = 0.1;

  let thresholdsStr = '';
  let stagesStr = '';
  if (thresholds) {
    thresholdsStr = `
    thresholds: {
      checks: ['rate>${1-thresholds.errorRate || 0.99}'],        // at least 99% of checks must pass
      http_req_duration: [{ threshold: 'p(95)<${thresholds.p95 || 500}', abortOnFail: false, delayAbortEval: '10s' }],
      http_req_failed: ['rate<${thresholds.errorRate || 0.1}'], // less than 1% of requests should fail
      custom_http_req_failed: ['rate<${thresholds.errorRate || 0.1}'], // less than 1% of requests should fail
    },`;
  }

  if (stages) {
    stagesStr = `
    stages: [
      { duration: '10s', target: 10 },  // ramp-up
      { duration: '20s', target: 10 },  // steady
      { duration: '10s', target: 0 },   // ramp-down
    ],`;
  } else stagesStr = `  duration: '${duration || '30s'}',`;

  return `
import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// const errorRate = new Rate('errors');

const errorRate = new Rate('custom_http_req_failed');
const successCount = new Counter('successful_requests');
const requestDuration = new Trend('request_duration');
const durationTrend = new Trend('custom_request_duration', true); // keep time series

export const options = {
    vus: ${vus || 10},
  ${stagesStr}${thresholdsStr}
};

export default function() {
  const url = '${url}';
  const params = {
    headers: ${headersStr},
  };

  let response;
  ${method === 'GET' ? `
  response = http.get(url, params);
  ` : `
  const payload = ${bodyStr};
  response = http.${method.toLowerCase()}(url, JSON.stringify(payload), params);
  `}

  const result = check(response, {
    'status is 200': (r) => r.status === 200,
    'response time OK': (r) => r.timings.duration < 2000,
    //'has expected field': (r) => r.body && r.body.includes('Example Domain'),
  });

  if (!result) {
    errorRate.add(1);
  } else {
    successCount.add(1);
    errorRate.add(0);
  }
  
  requestDuration.add(response.timings.duration);
  durationTrend.add(response.timings.duration);

  sleep(1);
}
`;
}

// Run K6 test
app.post('/api/run-test', async (req, res) => {
  try {
    const config = req.body;
    const testId = Date.now().toString();
    const scriptPath = path.join(scriptsDir, `test-${testId}.js`);
    const resultPath = path.join(resultsDir, `result-${testId}.json`);

    // Generate and save K6 script
    const script = generateK6Script(config);
    await fs.writeFile(scriptPath, script);

    // Run K6 test
    const command = `k6 run --out "json=${resultPath}" "${scriptPath}"`;
    console.log(`Starting Test - ${testId}`);

    exec(command, async (error, stdout, stderr) => {
      if (error) {
        console.error('K6 execution error:', error);
        // return;
      }
      console.log(`Completed Test - ${testId}`);

      // Parse results
      try {
        const rawData = await fs.readFile(resultPath, 'utf-8');
        const lines = rawData.trim().split('\n');
        const metrics = {
          requests: 0,
          failures: 0,//custom_http_req_failed
          failures1: 0,//http_req_failed
          checks: 0,
          durations: [],
          waitingTimes: [],
          statusCodes: {},
          startTime: null,
          endTime: null,
        };

        lines.forEach(line => {
          try {
            const data = JSON.parse(line);

            // Capture test start and end timestamps
            if (data.type === 'Point' && data.data?.time) {
              const t = new Date(data.data.time).getTime();
              if (!metrics.startTime || t < metrics.startTime) metrics.startTime = t;
              if (!metrics.endTime || t > metrics.endTime) metrics.endTime = t;
            }

            // Count total requests
            if (data.type === 'Point' && data.metric === 'http_reqs') {
              metrics.requests++;
            }
            if (data.type === 'Point' && data.metric === 'checks') {
              metrics.checks+=data.data.value;
            }

            // Count Failures
            if (data.type === 'Point' && data.metric === 'custom_http_req_failed') {
              metrics.failures1+=data.data.value;
            }
            if (data.type === 'Point' && data.metric === 'http_req_failed') {
              metrics.failures+=data.data.value;
            }

            // Track request durations
            if (data.type === 'Point' && data.metric === 'http_req_duration') {
              metrics.durations.push(data.data.value);
            }
            // Track waiting times (TTFB)
            if (data.type === 'Point' && data.metric === 'http_req_waiting') {
              metrics.waitingTimes.push(data.data.value);
            }

            if (data.type === 'Point' && data.data?.tags?.status) {
              const status = data.data.tags.status;
              metrics.statusCodes[status] = (metrics.statusCodes[status] || 0) + 1;
            }
          } catch (e) {
            // Skip invalid JSON lines
          }
        });

        // Calculate totalRequestsRate (requests per second)
        let totalRequestsRate = 0;
        if (metrics.startTime && metrics.endTime && metrics.requests > 0) {
          const durationSeconds = (metrics.endTime - metrics.startTime) / 1000;
          totalRequestsRate = metrics.requests / durationSeconds;
        }

        // Calculate averages
        const avgDuration = metrics.durations.length
          ? metrics.durations.reduce((a, b) => a + b, 0) / metrics.durations.length
          : 0;

        const avgWaiting = metrics.waitingTimes.length
          ? metrics.waitingTimes.reduce((a, b) => a + b, 0) / metrics.waitingTimes.length
          : 0;

        console.log(`Metrics for - ${testId}`, metrics);

        // Calculate statistics
        const sortedDurations = metrics.durations.sort((a, b) => a - b);
        const summary = {
          testId,
          timestamp: new Date().toISOString(),
          config,
          totalRequests: metrics.requests,
          totalRequestsRate: totalRequestsRate.toFixed(2),
          failedCount: metrics.failures,
          successCount: metrics.requests - metrics.failures,
          errorRate: Math.ceil(metrics.failures/metrics.requests)*100,
          successRate: ((metrics.requests - metrics.failures)>0)?Math.ceil((metrics.requests - metrics.failures)/metrics.requests)*100:0,
          statusCodes: metrics.statusCodes,
          avgDuration: avgDuration.toFixed(2),
          avgWaiting: avgWaiting.toFixed(2),
          //avgDuration: sortedDurations.length ? (sortedDurations.reduce((a, b) => a + b, 0) / sortedDurations.length).toFixed(2) : 0,

          minDuration: sortedDurations.length ? sortedDurations[0].toFixed(2) : 0,
          maxDuration: sortedDurations.length ? sortedDurations[sortedDurations.length - 1].toFixed(2) : 0,
          p50: sortedDurations.length ? 
            sortedDurations[Math.floor(sortedDurations.length * 0.5)].toFixed(2) : 0,
          p95: sortedDurations.length ? 
            sortedDurations[Math.floor(sortedDurations.length * 0.95)].toFixed(2) : 0,
          p99: sortedDurations.length ? 
            sortedDurations[Math.floor(sortedDurations.length * 0.99)].toFixed(2) : 0,
        };

        // Save summary
        await fs.writeFile(
          path.join(resultsDir, `summary-${testId}.json`),
          JSON.stringify(summary, null, 2)
        );

      } catch (parseError) {
        console.error('Error parsing results:', parseError);
      }
    });

    res.json({ 
      success: true, 
      testId,
      message: 'Test started successfully' 
    });

  } catch (error) {
    console.error('Error running test:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get test result
app.get('/api/result/:testId', async (req, res) => {
  try {
    const { testId } = req.params;
    const summaryPath = path.join(resultsDir, `summary-${testId}.json`);
    
    if(!fs1.existsSync(summaryPath)) {
      res.status(404).json({ 
        success: false, 
        error: 'Test results not ready yet. Please wait a moment.' 
      });
    } else {
      try {
        const summary = await fs.readFile(summaryPath, 'utf-8');
        res.json(JSON.parse(summary));
      } catch (err) {
        res.status(404).json({ 
          success: false, 
          error: 'Test results not ready yet. Please wait a moment.' 
        });
      }
    }
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// List all test results
app.get('/api/results', async (req, res) => {
  try {
    const files = await fs.readdir(resultsDir);
    const summaries = files
      .filter(f => f.startsWith('summary-'))
      .map(f => f.replace('summary-', '').replace('.json', ''));
    
    res.json({ results: summaries });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Fetch All Error Codes
app.get('/api/errorcodes', async (req, res) => {
  res.redirect('../errorcodes.json');
});

// Download report
app.get('/api/download/:testId', async (req, res) => {
  try {
    const { testId } = req.params;
    const summaryPath = path.join(resultsDir, `summary-${testId}.json`);
    const summary = JSON.parse(await fs.readFile(summaryPath, 'utf-8'));
    
    // Generate HTML report
    const report = `
<!DOCTYPE html>
<html>
<head>
  <title>Load Test Report - ${testId}</title>
  <style>
    body {
      font-family: sans-serif; margin: 20px; 
      background: rgba(255, 255, 255, 0.2);
      border-radius: 16px;
      box-shadow: 0 4px 30px rgba(0, 0, 0, 0.1);
      backdrop-filter: blur(5px);
      -webkit-backdrop-filter: blur(5px);
      border: 1px solid rgba(255, 255, 255, 0.3);
      padding: 20px;
    }
    .logobg {
      background: #333;
      border-radius: 16px;
      box-shadow: 0 4px 30px rgba(0, 0, 0, 0.1);
      backdrop-filter: blur(5px);
      -webkit-backdrop-filter: blur(5px);
      border: 1px solid rgba(255, 255, 255, 0.3);
      background-image: url(https://www.smartinfologiks.com/apps/silk/media/logos/logo-new.png);
      background-position: center center;
      background-repeat: no-repeat;
      position: fixed;
      right: 20px;
      top: 20px;
      z-index: 99999999;
      width: 350px;
      height: 82px;
    }
    h1 { color: #333; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
    th { background-color: #4CAF50; color: white; }
    .metric { background-color: #f9f9f9; }
    .interpretation, citie {color: #999;font-size:12px;}
  </style>
</head>
<body>
  <div class="logobg"></div>
  <h1>Load Test Report</h1>
  <p><strong>Test ID:</strong> ${testId}</p>
  <p><strong>Timestamp:</strong> ${summary.timestamp}</p>
  <p><strong>URL:</strong> ${summary.config.url}</p>
  <p><strong>Method:</strong> ${summary.config.method}</p>
  <p><strong>Virtual Users:</strong> ${summary.config.vus}</p>
  <p><strong>Duration:</strong> ${summary.config.duration}</p>
  
  <h2>Results</h2>
  <table>
    <tr><th>Metric</th><th>Value</th><th>Interpretation</th></tr>
    <tr class="metric"><td>Total Requests</td><td>${summary.totalRequests}</td><td class='interpretation'>Number of logical requests or iterations</td></tr>
    <tr><td>Requests per Second (RPS)</td><td>${summary.totalRequestsRate}</td><td class='interpretation'>RPS, Requests per second</td></tr>
    <tr class="metric"><td>Success Count</td><td>${summary.successCount}</td><td class='interpretation'>Sum of non-2xx/3xx responses</td></tr>
    <tr><td>Failure Count</td><td>${summary.failedCount}</td><td class='interpretation'>Error/Failed responses</td></tr>
    <tr class="metric"><td>Error Rate</td><td>${summary.errorRate}%</td><td class='interpretation'>(failedRequests / totalRequests) * 100</td></tr>
    <tr><td>Success Rate</td><td>${summary.successRate}%</td><td class='interpretation'>(1 - errorRate) * 100</td></tr>
    <tr class="metric"><td>Average Duration</td><td>${summary.avgDuration} ms</td><td class='interpretation'>Avg full round-trip time, Lower is better</td></tr>
    <tr><td>Average Waiting</td><td>${summary.avgWaiting} ms</td><td class='interpretation'>Avg server responsiveness, Lower is better</td></tr>
    <tr class="metric"><td>Min Duration</td><td>${summary.minDuration} ms</td><td class='interpretation'>Useful for spotting spikes</td></tr>
    <tr><td>Max Duration</td><td>${summary.maxDuration} ms</td><td class='interpretation'>Useful for spotting spikes</td></tr>
    <tr class="metric"><td>P50 (Median)</td><td>${summary.p50} ms</td><td class='interpretation'>More realistic than avg if you have outliers</td></tr>
    <tr><td>P95</td><td>${summary.p95} ms</td><td class='interpretation'>95th Percentile, Target SLA Metric</td></tr>
    <tr class="metric"><td>P99</td><td>${summary.p99} ms</td><td class='interpretation'>99th Percentile, Detects tail latency issues</td></tr>
    <tr><td>Time to First Byte (TTFB)</td><td>${summary.avgWaiting} ms</td><td class='interpretation'>Network + server latency combined</td></tr>
  </table>
  
  <h2>Status Codes <citie>(Reliability check, Actual number of HTTP responses received including retries, redirects, etc.)</citie></h2>
  <table>
    <tr><th>Status Code</th><th>Count</th></tr>
    ${Object.entries(summary.statusCodes).map(([code, count]) => 
      `<tr><td>${code}</td><td>${count}</td></tr>`
    ).join('')}
  </table>
</body>
</html>
    `;
    
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Disposition', `attachment; filename=report-${testId}.html`);
    // res.setHeader('Content-Disposition', `filename=report-${testId}.html`);
    res.send(report);
    
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});


// Get test history with all details
app.get('/api/history', async (req, res) => {
  try {
    const files = await fs.readdir(resultsDir);
    const summaryFiles = files.filter(f => f.startsWith('summary-') && f.endsWith('.json'));
    
    const tests = await Promise.all(
      summaryFiles.map(async (file) => {
        try {
          const filePath = path.join(resultsDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const summary = JSON.parse(content);
          
          // Extract test ID from filename
          const testId = file.replace('summary-', '').replace('.json', '');
          
          // Determine status based on available data
          let status = 'completed';
          if (!summary.totalRequests || summary.totalRequests === 0) {
            status = 'failed';
          }
          
          // Create test object with all necessary fields
          return {
            testId: summary.testId || testId,
            name: summary.name || `${summary.config?.method || 'GET'} ${summary.config?.url || 'Test'}`,
            timestamp: summary.timestamp,
            startTime: summary.timestamp,
            endTime: summary.timestamp,
            status: status,
            config: summary.config,
            results: {
              totalRequests: summary.totalRequests,
              totalRequestsRate: summary.totalRequestsRate,
              failedCount: summary.failedCount,
              successCount: summary.successCount,
              errorRate: summary.errorRate,
              successRate: summary.successRate,
              statusCodes: summary.statusCodes,
              avgDuration: summary.avgDuration,
              avgWaiting: summary.avgWaiting,
              minDuration: summary.minDuration,
              maxDuration: summary.maxDuration,
              p50: summary.p50,
              p95: summary.p95,
              p99: summary.p99
            }
          };
        } catch (err) {
          //console.error(`Error reading summary file ${file}:`, err);
          return null;
        }
      })
    );
    
    // Filter out null values and sort by timestamp (newest first)
    const validTests = tests
      .filter(test => test !== null)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    res.json({ 
      success: true, 
      tests: validTests 
    });
    
  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Delete a specific test
app.delete('/api/delete/:testId', async (req, res) => {
  try {
    const { testId } = req.params;
    
    // Define all files related to this test
    const filesToDelete = [
      path.join(resultsDir, `summary-${testId}.json`),
      path.join(resultsDir, `result-${testId}.json`),
      path.join(scriptsDir, `test-${testId}.js`)
    ];
    
    // Delete all files
    const deletePromises = filesToDelete.map(async (filePath) => {
      try {
        if (fs1.existsSync(filePath)) {
          await fs.unlink(filePath);
          console.log(`Deleted: ${filePath}`);
        }
      } catch (err) {
        console.error(`Error deleting ${filePath}:`, err);
      }
    });
    
    await Promise.all(deletePromises);
    
    res.json({ 
      success: true, 
      message: `Test ${testId} deleted successfully` 
    });
    
  } catch (error) {
    console.error('Error deleting test:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get statistics for all tests
app.get('/api/statistics', async (req, res) => {
  try {
    const files = await fs.readdir(resultsDir);
    const summaryFiles = files.filter(f => f.startsWith('summary-') && f.endsWith('.json'));
    
    let totalTests = 0;
    let successfulTests = 0;
    let failedTests = 0;
    let totalResponseTime = 0;
    let responseTimeCount = 0;
    
    await Promise.all(
      summaryFiles.map(async (file) => {
        try {
          const filePath = path.join(resultsDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const summary = JSON.parse(content);
          
          totalTests++;
          
          if (summary.totalRequests && summary.totalRequests > 0) {
            successfulTests++;
            
            if (summary.avgDuration) {
              totalResponseTime += parseFloat(summary.avgDuration);
              responseTimeCount++;
            }
          } else {
            failedTests++;
          }
        } catch (err) {
          console.error(`Error reading summary file ${file}:`, err);
        }
      })
    );
    
    const avgResponseTime = responseTimeCount > 0 
      ? (totalResponseTime / responseTimeCount).toFixed(2) 
      : 0;
    
    res.json({
      success: true,
      statistics: {
        totalTests,
        successfulTests,
        failedTests,
        avgResponseTime
      }
    });
    
  } catch (error) {
    console.error('Error calculating statistics:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.listen(PORT, () => {
  console.log(`K6 Load Testing Server running on http://localhost:${PORT}`);
  console.log('Make sure K6 is installed: https://k6.io/docs/getting-started/installation/');
});