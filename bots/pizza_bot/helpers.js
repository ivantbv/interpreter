function upper(text) {
    return text.toUpperCase();
  }

async function fetchExample() {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=42.5&longitude=27.4&current_weather=true`)
    const data = await res.json()
    console.log(data, 'data from the fetchexample')
    return data.current_weather
}
