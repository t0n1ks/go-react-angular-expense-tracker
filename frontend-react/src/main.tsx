// frontend-react/src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Navigate } from "react-router-dom";
import App from './App.tsx';
import './index.css';
import './i18n/index';
import { AuthProvider } from './context/AuthContext.tsx';
import { ThemeProvider } from './context/ThemeContext.tsx';

import Register from './pages/Register.tsx';
import Login from './pages/Login.tsx';
import Dashboard from './pages/Dashboard.tsx';
import Categories from './pages/Categories.tsx';
import Transactions from './pages/Transactions.tsx';
import Statistics from './pages/Statistics.tsx';
import PrivateRoute from './components/PrivateRoute.tsx';

const router = createBrowserRouter([
  {
    path: "/register",
    element: <Register />,
  },
  {
    path: "/login",
    element: <Login />,
  },
  {
    path: "/",
    element: <PrivateRoute><App /></PrivateRoute>,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "categories", element: <Categories /> },
      { path: "transactions", element: <Transactions /> },
      { path: "statistics", element: <Statistics /> },
    ],
  },
  {
    path: "*",
    element: <Navigate to="/" replace />,
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
);