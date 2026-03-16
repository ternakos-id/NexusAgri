export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  try {
    const { lat, lon, city } = req.query;
    const location = city || (lat && lon ? `${lat},${lon}` : 'Mojokerto');
    const response = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=j1`);
    const data = await response.json();
    const current = data.current_condition[0];
    const forecast = data.weather;
    res.status(200).json({
      temp: current.temp_C,
      feels_like: current.FeelsLikeC,
      humidity: current.humidity,
      desc: current.lang_id?.[0]?.value || current.weatherDesc[0].value,
      wind_kmph: current.windspeedKmph,
      forecast: forecast.slice(0, 5).map(d => ({
        date: d.date,
        max: d.maxtempC,
        min: d.mintempC,
        desc: d.hourly[4]?.lang_id?.[0]?.value || d.hourly[4]?.weatherDesc[0]?.value || '-'
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
