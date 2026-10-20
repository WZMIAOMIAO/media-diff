import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ImageComparePage from './pages/ImageComparePage';
import VideoComparePage from './pages/VideoComparePage';
import DownloadProgress from './components/DownloadProgress';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/image" replace />} />
        <Route path="/image" element={<ImageComparePage />} />
        <Route path="/video" element={<VideoComparePage />} />
        <Route path="*" element={<Navigate to="/image" replace />} />
      </Routes>
      <DownloadProgress />
    </BrowserRouter>
  );
}

export default App;
