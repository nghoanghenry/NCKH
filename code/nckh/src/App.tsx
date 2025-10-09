import './App.css'
import Map from './components/Map'

function App() {
  return (
    <div className="App" style={{ maxWidth: '100vw', margin: 0, padding: 0 }}>
      <header style={{ padding: '1rem', background: '#f8f9fa', borderBottom: '1px solid #dee2e6' }}>
        <h1 style={{ margin: 0, fontSize: '24px', color: '#333' }}>U Minh Hạ National Park - Bản đồ phân bố động thực vật</h1>
      </header>
      <main style={{ padding: '1rem' }}>
        <Map />
      </main>
    </div>
  )
}

export default App
