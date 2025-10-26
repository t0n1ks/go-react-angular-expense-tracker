// frontend-react/src/main.tsx (или main.jsx)
import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  createBrowserRouter,
  RouterProvider,
} from "react-router-dom";
import App from './App.tsx';
import './index.css';
import { AuthProvider } from './context/AuthContext.tsx';

// Импортируем компоненты страниц, которые мы создадим далее
import Register from './pages/Register.tsx';
import Login from './pages/Login.tsx';
import Dashboard from './pages/Dashboard.tsx';
import Categories from './pages/Categories.tsx';
import Transactions from './pages/Transactions.tsx';
import Statistics from './pages/Statistics.tsx';
import PrivateRoute from './components/PrivateRoute.tsx'; // Защищенный маршрут

// Определяем маршруты приложения
const router = createBrowserRouter([
  {
    path: "/register",
    element: <Register />,
  },
  {
    path: "/login",
    element: <Login />,
  },
  // Все защищенные маршруты будут обернуты в PrivateRoute
  {
    path: "/",
    element: <PrivateRoute><App /></PrivateRoute>, // App будет нашим макетом с навигацией
    children: [
      {
        index: true, // Это будет корневой маршрут внутри защищенной части
        element: <Dashboard />,
      },
      {
        path: "categories",
        element: <Categories />,
      },
      {
        path: "transactions",
        element: <Transactions />,
      },
      {
        path: "statistics",
        element: <Statistics />,
      },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
    <RouterProvider router={router} />
    </AuthProvider>
  </React.StrictMode>,
);