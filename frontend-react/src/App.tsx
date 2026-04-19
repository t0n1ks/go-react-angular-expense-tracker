// src/App.tsx
import React from 'react';
import { Outlet } from 'react-router-dom';
import Layout from './components/Layout';
import './App.css';

const App: React.FC = () => {
  // Нам не нужен <Router>, <Routes> или <AuthProvider> здесь, 
  // так как они уже есть в main.tsx или должны быть там.
  return (
    <Layout>
      <Outlet /> 
    </Layout>
  );
};

export default App;