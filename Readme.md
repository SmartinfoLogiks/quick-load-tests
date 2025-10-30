# K6 Load Testing Tool

A professional single-page application for load testing websites and REST endpoints using K6 as the backend test runner. Features a beautiful Bootstrap 5 UI with comprehensive reporting capabilities.

## Features

✅ **Easy to Use Interface** - Clean Bootstrap 5 UI with intuitive controls  
✅ **Multiple HTTP Methods** - Support for GET, POST, PUT, DELETE, PATCH  
✅ **Flexible Configuration** - Custom headers, request body, VUs, and duration  
✅ **Performance Thresholds** - Set P95 response time and error rate limits  
✅ **Real-time Results** - Automatic polling and display of test results  
✅ **Detailed Metrics** - Min, max, avg, P50, P95, P99 response times  
✅ **Status Code Analysis** - Track HTTP status code distribution  
✅ **Downloadable Reports** - Generate and download HTML reports  

## Prerequisites

### 1. Install Node.js
Download and install Node.js from [nodejs.org](https://nodejs.org/) (v14 or higher)

### 2. Install K6
K6 must be installed on your system:

**macOS (Homebrew):**
```bash
brew install k6
```

**Windows (Chocolatey):**
```bash
choco install k6
```

**Windows (MSI Installer):**
Download from [k6.io/docs/get-started/installation](https://k6.io/docs/get-started/installation/)

**Linux (Debian/Ubuntu):**
```bash
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

**Verify K6 installation:**
```bash
k6 version
```

## Installation

### 1. Create Project Structure
```bash
mkdir k6-load-tester
cd k6-load-tester
```

### 2. Create Files
Create the following files in your project directory:

- `package.json` - Copy content from the Package.json artifact
- `server.js` - Copy content from the Backend artifact
- Create a `public` folder and add `index.html` - Copy content from the Frontend artifact

Your structure should look like:
```
k6-load-tester/
├── server.js
├── package.json
└── public/
    └── index.html
```

### 3. Install Dependencies
```bash
npm install
```

## Usage

### 1. Start the Server
```bash
npm start
```

The server will start on `http://localhost:3000`

### 2. Open the Web Interface
Navigate to `http://localhost:3000` in your browser

### 3. Configure Your Test
- **Target URL**: Enter the endpoint you want to test
- **HTTP Method**: Select GET, POST, PUT, DELETE, or PATCH
- **Virtual Users (VUs)**: Number of concurrent users (1-1000)
- **Duration**: Test duration (e.g., 30s, 5m, 1h)
- **Headers**: Optional JSON object for request headers
- **Request Body**: JSON payload for POST/PUT/PATCH requests
- **Performance Thresholds**: Set P95 response time and max error rate

### 4. Run Test
Click "Start Load Test" and wait for results

### 5. View & Download Results
- View detailed metrics in the browser
- Download comprehensive HTML reports
- Run multiple tests and compare results

## Example Test Configurations

### Basic GET Request
```
URL: https://api.example.com/users
Method: GET
VUs: 10
Duration: 30s
```

### POST Request with Authentication
```
URL: https://api.example.com/login
Method: POST
Headers: {"Content-Type": "application/json"}
Body: {"username": "test", "password": "test123"}
VUs: 5
Duration: 1m
```

### High Load Test
```
URL: https://yoursite.com
Method: GET
VUs: 100
Duration: 5m
Thresholds: P95 < 500ms, Error Rate < 0.05
```

## Understanding Results

### Metrics Explained
- **Total Requests**: Number of HTTP requests made during the test
- **Avg Duration**: Average response time across all requests
- **Min/Max Duration**: Fastest and slowest response times
- **P50 (Median)**: 50% of requests were faster than this value
- **P95**: 95% of requests were faster than this value
- **P99**: 99% of requests were faster than this value
- **Status Codes**: Distribution of HTTP response codes

### Performance Thresholds
- **P95 Response Time**: Fails if 95th percentile exceeds threshold
- **Max Error Rate**: Fails if error rate exceeds threshold (0.1 = 10%)

## Troubleshooting

### "K6 command not found"
Make sure K6 is installed and in your PATH. Run `k6 version` to verify.

### Port 3000 already in use
Change the PORT in `server.js`:
```javascript
const PORT = 3001; // Change to any available port
```

### Test results not appearing
- Wait 5-10 seconds after test starts
- Check server console for errors
- Ensure target URL is accessible

### CORS errors
The server includes CORS support. If you still have issues, check your target server's CORS configuration.

## API Endpoints

- `POST /api/run-test` - Start a new load test
- `GET /api/result/:testId` - Get test results
- `GET /api/results` - List all test results
- `GET /api/download/:testId` - Download HTML report

## Development

Run with auto-restart on file changes:
```bash
npm run dev
```

## Generated Files

The application creates two directories:
- `k6-scripts/` - Contains generated K6 test scripts
- `results/` - Stores test results and summaries

## Tips for Effective Load Testing

1. **Start Small**: Begin with low VUs and short duration
2. **Ramp Up Gradually**: Increase load progressively
3. **Monitor Server**: Watch your server's CPU/memory during tests
4. **Test in Stages**: Test different endpoints separately
5. **Use Realistic Data**: Mirror production traffic patterns
6. **Set Baselines**: Record initial performance for comparison
7. **Test Regularly**: Make load testing part of your CI/CD

## License

MIT License - Feel free to use and modify for your projects!

## Support

For K6 documentation: [k6.io/docs](https://k6.io/docs/)  
For issues with this tool: Check server console logs for detailed error messages