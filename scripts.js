/**
 * CONFIGURATION & STATE
 */
const API_GEO = "https://geocoding-api.open-meteo.com/v1/search";
const API_WEATHER = "https://api.open-meteo.com/v1/forecast";

let temperatureUnit = "celsius";
let windSpeedUnit = "kmh";
let precipitationUnit = "mm";

// DOM Elements
const unitsBtn = document.getElementById('units-toggle-btn');
const unitsDropdown = document.getElementById('units-dropdown');
const dayBtn = document.getElementById('day-toggle-btn');
const dayDropdown = document.getElementById('day-dropdown');
const searchBtn = document.getElementById('search-btn');
const cityInput = document.getElementById('city-input');

/**
 * 1. UI INTERACTION (Dropdowns)
 */

// Toggle Dropdowns
const toggleMenu = (btn, menu) => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = menu.style.display === 'block';
        // Close all first
        document.querySelectorAll('.dropdown-menu').forEach(m => m.style.display = 'none');
        menu.style.display = isVisible ? 'none' : 'block';
    });
};

toggleMenu(unitsBtn, unitsDropdown);
toggleMenu(dayBtn, dayDropdown);

// Close on outside click
document.addEventListener('click', () => {
    unitsDropdown.style.display = 'none';
    dayDropdown.style.display = 'none';
    const cityResultsDropdown = document.getElementById('city-results-dropdown');
    if (cityResultsDropdown) cityResultsDropdown.style.display = 'none';
});

// Handle item selection (Visual checkmark update)
document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', function(e) {
        e.stopPropagation();
        // Find the parent section to only clear sibling active states
        const parent = this.parentElement;
        parent.querySelectorAll('.menu-item').forEach(sibling => {
            sibling.classList.remove('active');
            const check = sibling.querySelector('.check');
            if (check) check.remove();
        });

        // Set current as active
        this.classList.add('active');
        
        // Add checkmark if it's a unit setting
        if (parent.classList.contains('menu-section')) {
            const checkSpan = document.createElement('span');
            checkSpan.className = 'check';
            checkSpan.innerText = ' ✓';
            this.appendChild(checkSpan);
            
            // Handle unit change logic here if needed
            const text = this.innerText;
            let changed = false;
            if (text.includes('Fahrenheit')) {
                temperatureUnit = 'fahrenheit'; changed = true;
            } else if (text.includes('Celsius')) {
                temperatureUnit = 'celsius'; changed = true;
            } else if (text.includes('mph')) {
                windSpeedUnit = 'mph'; changed = true;
            } else if (text.includes('km/h')) {
                windSpeedUnit = 'kmh'; changed = true;
            } else if (text.includes('Millimeters')) {
                precipitationUnit = 'mm'; changed = true;
            } else if (text.includes('Inches')) {
                precipitationUnit = 'inch'; changed = true;
            }
            
            if (changed) {
                if (typeof activeLocation !== 'undefined' && activeLocation) fetchAndDisplayWeather(activeLocation);
                else if (cityInput.value) getWeatherData(cityInput.value);
                else getWeatherData('Tunis');
            }
        }
    });
});

/**
 * 2. WEATHER DATA FETCHING
 */

let currentCityResults = [];
let activeLocation = null;
let currentWeatherData = null;

const statusContainer = document.getElementById('status-container');
const statusContent = document.getElementById('status-content');
const mainDashboard = document.getElementById('main-dashboard');
const hourlySidebar = document.getElementById('hourly-sidebar');

function showStatus(type, message = '', showRetry = false) {
    mainDashboard.style.display = 'none';
    hourlySidebar.style.display = 'none';
    statusContainer.style.display = 'flex';
    
    let icon = '';
    if (type === 'loading') icon = '⏳';
    else if (type === 'error') icon = '⚠️';
    else if (type === 'empty') icon = '🔍';
    
    statusContent.innerHTML = `
        <div class="status-icon">${icon}</div>
        <div class="status-message">${message}</div>
        ${showRetry ? `<button class="retry-btn" onclick="retryLastAction()">Retry</button>` : ''}
    `;
}

function hideStatus() {
    mainDashboard.style.display = 'grid';
    hourlySidebar.style.display = 'block';
    statusContainer.style.display = 'none';
}

function retryLastAction() {
    if (cityInput.value) getWeatherData(cityInput.value, true);
    else if (activeLocation) fetchAndDisplayWeather(activeLocation);
}

async function fetchGeocodingResults(query) {
    try {
        let results = [];
        const res = await fetch(`${API_GEO}?name=${encodeURIComponent(query)}&count=10&language=en&format=json`);
        const data = await res.json();
        
        if (data.results && data.results.length > 0) {
            results = data.results;
        } else {
            // Fuzzy search fallback using Wikipedia OpenSearch
            try {
                const wikiRes = await fetch(`https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=5&origin=*`);
                const wikiData = await wikiRes.json();
                if (wikiData[1] && wikiData[1].length > 0) {
                    const suggestions = wikiData[1];
                    const tried = new Set();
                    for (let i = 0; i < suggestions.length; i++) {
                        let suggestion = suggestions[i];
                        // Clean up suggestion
                        suggestion = suggestion.split(',')[0].split(' (')[0].replace(/ Governorate| Province| State| City| District/gi, '').trim();
                        
                        if (tried.has(suggestion.toLowerCase())) continue;
                        tried.add(suggestion.toLowerCase());

                        const altGeoRes = await fetch(`${API_GEO}?name=${encodeURIComponent(suggestion)}&count=5&language=en&format=json`);
                        const altGeoData = await altGeoRes.json();
                        if (altGeoData.results && altGeoData.results.length > 0) {
                            results = results.concat(altGeoData.results);
                        }
                        if (results.length >= 5) break;
                    }
                    
                    // Remove duplicates by id
                    if (results.length > 0) {
                        const uniqueResults = [];
                        const seenIds = new Set();
                        for (const res of results) {
                            if (!seenIds.has(res.id)) {
                                seenIds.add(res.id);
                                uniqueResults.push(res);
                            }
                        }
                        results = uniqueResults;
                    }
                }
            } catch (e) {
                console.error("Fuzzy search fallback failed", e);
            }
        }
        return results;
    } catch (error) {
        console.error("Error fetching geocoding results:", error);
        return [];
    }
}

async function getWeatherData(cityName, autoSelectFirst = false) {
    showStatus('loading', 'Searching for city...');
    try {
        const results = await fetchGeocodingResults(cityName);

        if (!results || results.length === 0) {
            showStatus('empty', 'No search result found!', true);
            return;
        }

        currentCityResults = results;
        
        if (currentCityResults.length === 1 || autoSelectFirst) {
            await fetchAndDisplayWeather(currentCityResults[0]);
        } else {
            hideStatus();
            const searchSuggestions = document.getElementById('search-suggestions');
            searchSuggestions.innerHTML = '';
            currentCityResults.forEach(result => {
                const item = document.createElement('div');
                item.className = 'suggestion-item';
                const regionHtml = result.admin1 ? `<div class="suggestion-region">${result.admin1}</div>` : '';
                item.innerHTML = `
                    <div class="suggestion-main">
                        <span class="suggestion-name">${result.name}</span>
                        <span class="suggestion-country">${result.country}</span>
                    </div>
                    ${regionHtml}
                `;
                item.addEventListener('click', () => {
                    cityInput.value = result.name;
                    searchSuggestions.style.display = 'none';
                    fetchAndDisplayWeather(result);
                });
                searchSuggestions.appendChild(item);
            });
            searchSuggestions.style.display = 'flex';
        }

    } catch (error) {
        console.error("Error fetching weather:", error);
        showStatus('error', 'We couldn\'t connect to the server (API error). Please try again.', true);
    }
}

async function fetchAndDisplayWeather(locationObj) {
    showStatus('loading', 'Fetching weather data...');
    try {
        activeLocation = locationObj;
        const { latitude, longitude, name, country, admin1 } = locationObj;
        
        const cityPart = document.getElementById('city-name-part');
        const countryPart = document.getElementById('country-name-part');
        const commaPart = document.getElementById('comma-part');
        
        cityPart.innerText = name;
        
        // If multiple results exist, make the country part a clickable dropdown toggle
        if (currentCityResults.length > 1) {
            const region = admin1 ? `${admin1}, ` : '';
            countryPart.innerHTML = `${region}${country} <span style="font-size: 0.7em; margin-left: 2px;">▾</span>`;
            countryPart.className = 'clickable-country';
            commaPart.style.display = 'inline';
        } else {
            const region = admin1 ? `${admin1}, ` : '';
            countryPart.innerText = `${region}${country}`;
            countryPart.className = '';
            commaPart.style.display = 'inline';
        }
        
        const dateOptions = { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' };
        document.getElementById('current-date').innerText = new Date().toLocaleDateString('en-US', dateOptions);

        // Step 2: Get Weather using Coordinates
        const unitParams = `temperature_unit=${temperatureUnit}&wind_speed_unit=${windSpeedUnit}&precipitation_unit=${precipitationUnit}`;

        const weatherUrl = `${API_WEATHER}?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code,is_day&hourly=temperature_2m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&${unitParams}`;
        
        const weatherRes = await fetch(weatherUrl);
        if (!weatherRes.ok) throw new Error("Failed to fetch weather data");
        const weatherData = await weatherRes.json();

        currentWeatherData = weatherData;
        updateUI(weatherData);
        hideStatus();
    } catch (error) {
        console.error("Error fetching weather details:", error);
        showStatus('error', 'Failed to fetch weather data. Please check your network connection.', true);
    }
}

// Handle Country Click for Disambiguation Dropdown
const countryPart = document.getElementById('country-name-part');
const cityResultsDropdown = document.getElementById('city-results-dropdown');

if (countryPart && cityResultsDropdown) {
    countryPart.addEventListener('click', (e) => {
        if (currentCityResults.length > 1) {
            e.stopPropagation();
            const isVisible = cityResultsDropdown.style.display === 'flex';
            
            // Close other dropdowns
            document.querySelectorAll('.dropdown-menu').forEach(m => m.style.display = 'none');
            
            if (!isVisible) {
                cityResultsDropdown.innerHTML = '';
                currentCityResults.forEach(result => {
                    const item = document.createElement('div');
                    item.className = 'city-result-item';
                    const region = result.admin1 ? `${result.admin1}, ` : '';
                    item.innerHTML = `
                        <span class="city-result-name">${result.name}</span>
                        <span class="city-result-sub">${region}${result.country}</span>
                    `;
                    item.addEventListener('click', () => {
                        fetchAndDisplayWeather(result);
                        cityResultsDropdown.style.display = 'none';
                    });
                    cityResultsDropdown.appendChild(item);
                });
                cityResultsDropdown.style.display = 'flex';
            } else {
                cityResultsDropdown.style.display = 'none';
            }
        }
    });
}

/**
 * 3. WEATHER STATE MAPPING
 */
function getWeatherIcon(code, isDay = 1) {
    const sunnyCodes = [0];
    const partlyCloudyCodes = [1, 2];
    const cloudyCodes = [3];
    const fogCodes = [45, 48];
    const drizzleCodes = [51, 53, 55, 56, 57];
    const rainCodes = [61, 63, 65, 66, 67, 80, 81, 82];
    const snowCodes = [71, 73, 75, 77, 85, 86];
    const stormCodes = [95, 96, 99];

    if (sunnyCodes.includes(code)) return isDay ? 'icon-sunny.webp' : 'icon-clear-night.webp';
    if (partlyCloudyCodes.includes(code)) return isDay ? 'icon-partly-cloudy.webp' : 'icon-partly-cloudy-night.webp';
    if (cloudyCodes.includes(code)) return isDay ? 'icon-overcast.webp' : 'icon-overcast-night.webp';
    if (fogCodes.includes(code)) return isDay ? 'icon-fog.webp' : 'icon-fog-night.webp';
    if (drizzleCodes.includes(code)) return isDay ? 'icon-drizzle.webp' : 'icon-drizzle-night.webp';
    if (rainCodes.includes(code)) return isDay ? 'icon-rain.webp' : 'icon-rain-night.webp';
    if (stormCodes.includes(code)) return isDay ? 'icon-storm.webp' : 'icon-storm-night.webp';
    if (snowCodes.includes(code)) return isDay ? 'icon-snow.webp' : 'icon-snow-night.webp';
    
    return isDay ? 'icon-sunny.webp' : 'icon-clear-night.webp'; // fallback
}

function updateWeatherState(code, isDay) {
    const heroCard = document.querySelector('.hero-card');
    heroCard.className = 'hero-card'; // reset classes
    
    let state = 'sunny';
    const icon = getWeatherIcon(code, isDay);
    
    if (icon.includes('sunny')) state = 'sunny';
    if (icon.includes('partly-cloudy')) state = 'partly-cloudy';
    if (icon.includes('overcast')) state = 'cloudy';
    if (icon.includes('fog')) state = 'fog';
    if (icon.includes('drizzle')) state = 'drizzle';
    if (icon.includes('rain')) state = 'rain';
    if (icon.includes('storm')) state = 'storm';
    if (icon.includes('snow')) state = 'snow';
    
    if (!isDay && state === 'sunny') state = 'clear-night';
    if (!isDay && state === 'partly-cloudy') state = 'partly-cloudy-night';

    heroCard.classList.add(`state-${state}`);
    return icon;
}

/**
 * 4. UPDATE UI COMPONENTS
 */

function updateUI(data) {
    const current = data.current;
    
    // Update Hero & Stats
    document.getElementById('main-temp').innerText = `${Math.round(current.temperature_2m)}°`;
    document.getElementById('feels-like').innerText = `${Math.round(current.apparent_temperature)}°`;
    document.getElementById('humidity').innerText = `${current.relative_humidity_2m}%`;
    document.getElementById('wind').innerText = `${current.wind_speed_10m} ${windSpeedUnit === 'kmh' ? 'km/h' : 'mph'}`;
    document.getElementById('precip').innerText = `${data.daily.precipitation_sum[0] || 0} ${precipitationUnit === 'mm' ? 'mm' : 'in'}`;

    // Update Hero Icon and Background State
    const mainIconName = updateWeatherState(current.weather_code, current.is_day);
    const mainIconEl = document.querySelector('.temp-main img');
    mainIconEl.src = `/assets/images/${mainIconName}`;

    // Populate Day Dropdown dynamically
    const dayDropdown = document.getElementById('day-dropdown');
    dayDropdown.innerHTML = '';
    const fullDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    for (let i = 0; i < 7; i++) {
        if (i >= data.daily.time.length) break;
        const [y, m, d] = data.daily.time[i].split('-');
        const date = new Date(y, m - 1, d);
        const dayName = i === 0 ? 'Today' : fullDays[date.getDay()];
        
        const item = document.createElement('div');
        item.className = `menu-item ${i === 0 ? 'active' : ''}`;
        item.innerText = dayName;
        item.dataset.index = i;
        
        item.addEventListener('click', function(e) {
            e.stopPropagation();
            dayDropdown.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
            this.classList.add('active');
            document.getElementById('day-toggle-btn').innerText = this.innerText + ' ▾';
            dayDropdown.style.display = 'none';
            renderHourlyForecast(parseInt(this.dataset.index));
        });
        
        dayDropdown.appendChild(item);
    }
    
    document.getElementById('day-toggle-btn').innerText = 'Today ▾';
    renderHourlyForecast(0);

    // Update 7-Day Forecast
    const dailyList = document.getElementById('daily-list');
    dailyList.innerHTML = ""; // Clear placeholders

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    for (let i = 0; i < 7; i++) {
        if (i >= data.daily.time.length) break;
        
        const [y, m, d] = data.daily.time[i].split('-');
        const date = new Date(y, m - 1, d);
        const dayName = days[date.getDay()];
        const max = Math.round(data.daily.temperature_2m_max[i]);
        const min = Math.round(data.daily.temperature_2m_min[i]);
        const dIcon = getWeatherIcon(data.daily.weather_code[i], 1);

        const item = document.createElement('div');
        item.className = 'daily-item';
        item.innerHTML = `
            <span class="day">${dayName}</span>
            <img src="/assets/images/${dIcon}" alt="" onerror="this.style.display='none'">
            <div class="range">
                <span class="max">${max}°</span>
                <span class="min">${min}°</span>
            </div>
        `;
        dailyList.appendChild(item);
    }
}

function renderHourlyForecast(dayIndex) {
    if (!currentWeatherData) return;
    const data = currentWeatherData;
    const hourlyList = document.querySelector('.hourly-list');
    hourlyList.innerHTML = ""; 

    const targetDateString = data.daily.time[dayIndex];
    
    const dayIndices = [];
    for (let i = 0; i < data.hourly.time.length; i++) {
        if (data.hourly.time[i].startsWith(targetDateString)) {
            dayIndices.push(i);
        }
    }

    let displayIndices = [];
    if (dayIndex === 0) {
        const nowTime = new Date().getTime();
        let startIndex = dayIndices[0];
        for (let i of dayIndices) {
            if (new Date(data.hourly.time[i]).getTime() >= nowTime) {
                startIndex = i;
                break;
            }
        }
        for (let i = startIndex; i < startIndex + 8; i++) {
            if (i < data.hourly.time.length) displayIndices.push(i);
        }
    } else {
        for (let i = 0; i < 24; i += 3) {
            if (dayIndices[i] !== undefined) displayIndices.push(dayIndices[i]);
        }
    }

    displayIndices.forEach(i => {
        const timeStr = data.hourly.time[i];
        const time = new Date(timeStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const temp = Math.round(data.hourly.temperature_2m[i]);
        const hIcon = getWeatherIcon(data.hourly.weather_code[i], data.hourly.is_day[i]);
        
        const row = document.createElement('div');
        row.className = 'hourly-row';
        row.innerHTML = `
            <div class="hour-info">
                <img src="/assets/images/${hIcon}" alt="" onerror="this.style.display='none'">
                <span>${time}</span>
            </div>
            <span class="hour-temp">${temp}°</span>
        `;
        hourlyList.appendChild(row);
    });
}

/**
 * 5. EVENT LISTENERS
 */

const searchSuggestions = document.getElementById('search-suggestions');
let searchTimeout;

cityInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();
    if (query.length < 2) {
        searchSuggestions.style.display = 'none';
        return;
    }
    
    searchTimeout = setTimeout(async () => {
        try {
            const results = await fetchGeocodingResults(query);
            
            if (results && results.length > 0) {
                searchSuggestions.innerHTML = '';
                results.forEach(result => {
                    const item = document.createElement('div');
                    item.className = 'suggestion-item';
                    const regionHtml = result.admin1 ? `<div class="suggestion-region">${result.admin1}</div>` : '';
                    item.innerHTML = `
                        <div class="suggestion-main">
                            <span class="suggestion-name">${result.name}</span>
                            <span class="suggestion-country">${result.country}</span>
                        </div>
                        ${regionHtml}
                    `;
                    item.addEventListener('click', () => {
                        cityInput.value = result.name;
                        searchSuggestions.style.display = 'none';
                        fetchAndDisplayWeather(result);
                    });
                    searchSuggestions.appendChild(item);
                });
                searchSuggestions.style.display = 'flex';
            } else {
                searchSuggestions.innerHTML = '<div class="suggestion-item" style="text-align: center; color: var(--text-gray); font-size: 0.85rem;">No results found</div>';
                searchSuggestions.style.display = 'flex';
            }
        } catch (err) {
            console.error("Error fetching suggestions:", err);
        }
    }, 300);
});

// Close suggestions on outside click
document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrapper')) {
        if (searchSuggestions) searchSuggestions.style.display = 'none';
    }
});

searchBtn.addEventListener('click', () => {
    if (cityInput.value) getWeatherData(cityInput.value);
});

cityInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && cityInput.value) getWeatherData(cityInput.value);
});

// Initial Load
window.addEventListener('load', () => {
    getWeatherData('Tunis', true); // Default city
});
