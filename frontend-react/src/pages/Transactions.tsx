// frontend-react/src/pages/Transactions.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { Plus, Edit, Trash2, Filter } from 'lucide-react';
//  ИМПОРТИРУЕМ СТИЛИ
import './Transactions.css'; 

// Интерфейсы данных
interface Category {
 id: number;
 name: string;
}

interface Transaction {
 id: number;
 amount: number;
 date: string; // Формат "YYYY-MM-DDTHH:MM:SSZ"
 description: string;
 type: 'expense' | 'income'; 
 category: Category; 
}

// --- БЕЗОПАСНАЯ ОБРАБОТКА ОШИБОК AXIOS ---
interface AxiosErrorLike extends Error {
 response?: {
 data: {
 error?: string;
 };
 };
 message: string;
}
const isAxiosErrorLike = (error: unknown): error is AxiosErrorLike => {
 return (
 typeof error === 'object' && 
 error !== null && 
 'message' in error && 
 typeof (error as AxiosErrorLike).message === 'string' &&
 'response' in error 
 );
};

// Функция для форматирования даты в YYYY-MM-DD
const formatDateToInput = (isoDate?: string | Date): string => {
 const dateObj = isoDate ? new Date(isoDate) : new Date();
 const year = dateObj.getFullYear();
const month = String(dateObj.getMonth() + 1).padStart(2, '0');
 const day = String(dateObj.getDate()).padStart(2, '0');
 return `${year}-${month}-${day}`;
};
// ----------------------------------------------------------------

const Transactions: React.FC = () => {
 const { axiosInstance } = useAuth();
 const [transactions, setTransactions] = useState<Transaction[]>([]);
 const [categories, setCategories] = useState<Category[]>([]);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState('');
 const [isModalOpen, setIsModalOpen] = useState(false);
 const [currentPage, setCurrentPage] = useState(1);
 const [totalPages, setTotalPages] = useState(1);
 const limit = 10;

 const [currentTransaction, setCurrentTransaction] = useState<Transaction | null>(null);
 const [formState, setFormState] = useState({
 amount: '',
 description: '',
 date: formatDateToInput(),
 category_id: '',
 type: 'expense',
 });
 const [formError, setFormError] = useState('');


 // 1. Загрузка категорий (READ)
 const fetchCategories = useCallback(async () => {
  try {
 const response = await axiosInstance.get('/categories');
 const fetchedCategories: Category[] = response.data.categories || [];
 setCategories(fetchedCategories);

 // Установка ID первой категории по умолчанию, если они есть
 if (fetchedCategories.length > 0 && formState.category_id === '') {
 setFormState(prev => ({ ...prev, category_id: fetchedCategories[0].id.toString() }));
 }
} catch (err) {
 console.error("Не удалось загрузить категории:", err);
 setError(prev => prev + " | Не удалось загрузить категории.");
 }
 }, [axiosInstance, formState.category_id]);

 // 2. Загрузка транзакций (READ)
 const fetchTransactions = useCallback(async (page: number) => {
     setLoading(true);
 setError('');
try {
 const response = await axiosInstance.get(`/transactions?page=${page}&limit=${limit}`);

setTransactions(response.data.transactions || []);
 setTotalPages(response.data.total_pages || 1);
 setCurrentPage(response.data.current_page || 1);

 } catch (err) {
 console.error("Не удалось загрузить транзакции:", err);
 let errorMessage = "Не удалось загрузить транзакции.";
 if (isAxiosErrorLike(err) && err.response?.data?.error) {
 errorMessage = err.response.data.error;
 }
 setError(errorMessage);
 } finally {
 setLoading(false);
 }
 }, [axiosInstance, limit]);


 // Запуск загрузки
 useEffect(() => {
 fetchCategories();
 fetchTransactions(currentPage);
 }, [fetchCategories, fetchTransactions, currentPage]);


 // --- Пагинация ---
 const handlePageChange = (newPage: number) => {
 if (newPage >= 1 && newPage <= totalPages) {
 setCurrentPage(newPage);
 }
 };


 // --- Модальное окно и форма ---

 // Функция открытия модального окна для редактирования
 const openEditModal = (transaction: Transaction) => {
 setCurrentTransaction(transaction);
setFormState({
 amount: transaction.amount.toString(),
 description: transaction.description || '',
 date: formatDateToInput(transaction.date), 
 category_id: transaction.category.id.toString(),
 type: transaction.type,
});
 setFormError('');
 setIsModalOpen(true);
 };
    
 // Функция открытия модального окна для создания
 const openCreateModal = () => {
 setCurrentTransaction(null); // Режим создания
 setFormState({
 amount: '',
 description: '',
 date: formatDateToInput(),
 category_id: categories[0]?.id.toString() || '',
 type: 'expense',
 });
  setFormError('');
 setIsModalOpen(true);
 };

 const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
const { name, value } = e.target;
 setFormState(prev => ({ ...prev, [name]: value }));
 };


 // --- CREATE/UPDATE: Обработчик сохранения транзакции ---
 const handleSaveTransaction = async (e: React.FormEvent) => {
  e.preventDefault();
setFormError('');

 if (!formState.amount || !formState.category_id || !formState.date) {
 setFormError('Поля Сумма, Дата и Категория обязательны.');
 return;
 }

 const isUpdate = currentTransaction !== null;
 
 try {
 const payload = {
 amount: parseFloat(formState.amount),
 description: formState.description.trim(),
 date: formState.date,
 category_id: parseInt(formState.category_id),
 type: formState.type,
 };

 if (isUpdate) {
 // UPDATE (PUT)
 await axiosInstance.put(`/transactions/${currentTransaction?.id}`, payload);
 } else {
 // CREATE (POST)
 await axiosInstance.post('/transactions', payload);
 }

 setIsModalOpen(false);
 setCurrentTransaction(null);
 // После сохранения/изменения, перезагружаем текущую страницу
 fetchTransactions(currentPage); 

 } catch (err) {
 console.error("Ошибка при сохранении транзакции:", err);
 let errorMessage = isUpdate ? "Не удалось обновить транзакцию." : "Не удалось создать транзакцию.";
if (isAxiosErrorLike(err) && err.response?.data?.error) {
 errorMessage = err.response.data.error;
 }
 setFormError(errorMessage);
 }
 };


 // --- DELETE: Обработчик удаления транзакции ---
 const handleDeleteTransaction = async (transactionId: number) => {
 // Подтверждение действия
if (!window.confirm("Вы уверены, что хотите удалить эту транзакцию?")) {
 return;
 }
 
 try {
 await axiosInstance.delete(`/transactions/${transactionId}`);
 // Перезагружаем текущую страницу для обновления списка
 
 } catch (err) {
 console.error("Ошибка при удалении транзакции:", err);
 let errorMessage = "Не удалось удалить транзакцию.";
 if (isAxiosErrorLike(err) && err.response?.data?.error) {
 errorMessage = err.response.data.error;
 }
 setError(errorMessage); 
 }
 };


 // --- РЕНДЕРИНГ ---

 if (loading && transactions.length === 0) {
 // Используем CSS класс для контейнера
return <div className="transactions-page-container text-center text-gray-500">Загрузка транзакций...</div>;
 }

 if (error && transactions.length === 0) {
// Используем CSS класс для контейнера
 return <div className="transactions-page-container text-center text-red-500 font-bold">{error}</div>;
 }


 return (
 <div className="transactions-page-container">
  <h1 className="transactions-header">История транзакций</h1>

 {/* Панель управления (Фильтр и Создание) */}
 {/* Оставляем Tailwind классы для flex/justify, т.к. их нет в CSS */}
 <div className="flex justify-between items-center mb-6">
 <button 
 className="transaction-btn-primary" 
 onClick={openCreateModal}
 >
 <Plus className="w-5 h-5 mr-2" /> Добавить транзакцию
 </button>
 {/* Оставляем Tailwind классы для flex, т.к. их нет в CSS */}
 <button className="text-gray-600 hover:text-blue-600 flex items-center p-2 rounded-lg transition duration-200">
 <Filter className="w-5 h-5 mr-1" /> Фильтр (В разработке)
 </button>
</div>

{/* Сообщение об общей ошибке */}
{error && transactions.length > 0 && (
 <div className="error-alert" role="alert">
 <span className="block">{error}</span>
 </div>
 )}

 {/* Таблица транзакций */}
 <div className="transactions-table-wrapper">
 <table className="transactions-table">
 <thead>
 <tr>
 <th className="transactions-table th">Дата</th>
 <th className="transactions-table th">Описание</th>
 <th className="transactions-table th">Категория</th>
 <th className="transactions-table th text-right">Сумма</th>
 <th className="transactions-table th text-right">Тип</th>
 <th className="transactions-table th text-right">Действия</th>
 </tr>
</thead>
  <tbody>
  {transactions.length === 0 && !loading ? (
  <tr>
    <td colSpan={6} className="transactions-table td text-center text-lg">
    Транзакций не найдено. Добавьте первую!
    </td>
  </tr>
  ) : (
  transactions.map((t) => (
  <tr key={t.id}>
    <td className="transactions-table td">
    {new Date(t.date).toLocaleDateString('ru-RU', { year: 'numeric', month: '2-digit', day: '2-digit' })}
    </td>
    <td className="transactions-table td">{t.description || "—"}</td>
    <td className="transactions-table td">{t.category?.name || 'Нет категории'}</td>
    <td className="transactions-table td text-right">
    <span className={t.type === 'expense' ? 'amount-expense' : 'amount-income'}>
    {t.type === 'expense' ? '-' : '+'} {t.amount.toFixed(2)} USD
    </span>
    </td>
    <td className="transactions-table td text-right">
 <span className={`type-badge ${t.type === 'expense' ? 'badge-expense' : 'badge-income'}`}>
 {t.type === 'expense' ? 'Расход' : (t.type === 'income' ? 'Доход' : 'Неизвестно')}
</span>
</td>
    <td className="transactions-table td">
    <div className="action-cell-container">
    <button 
    title="Редактировать" 
    className="action-button action-edit"
    onClick={() => openEditModal(t)}
    >
    <Edit className="w-5 h-5" />
    </button>
    <button 
    title="Удалить" 
    className="action-button action-delete"
    onClick={() => handleDeleteTransaction(t.id)}
    >
    <Trash2 className="w-5 h-5" />
    </button>
    </div>
    </td>
  </tr>
  ))
  )}
  </tbody>
  </table>
  </div>


  {/* Пагинация */}
  {totalPages > 1 && (
  <div className="pagination-container">
  <button 
  onClick={() => handlePageChange(currentPage - 1)}
  disabled={currentPage === 1}
  className="pagination-button"
  >
  Предыдущая
  </button>
  <span className="pagination-info">
  Страница {currentPage} из {totalPages}
  </span>
  <button 
  onClick={() => handlePageChange(currentPage + 1)}
  disabled={currentPage === totalPages}
  className="pagination-button"
  >
  Следующая
  </button>
  </div>
  )}


  {/* Модальное окно создания/редактирования */}
  {isModalOpen && (
  <div className="modal-overlay">
  <div className="modal-content">
  
  {/* Кнопка закрытия */}
  <button
  type="button"
  onClick={() => setIsModalOpen(false)}
  className="modal-close-button"
  >
  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
  </svg>
  </button>


  <h3 className="modal-title">
  {currentTransaction ? 'Редактировать транзакцию' : 'Добавить новую транзакцию'}
  </h3>

  {formError && (
  <div className="error-alert" role="alert">
  <span className="block">{formError}</span>
  </div>
  )}

  <form onSubmit={handleSaveTransaction}>
  <div>
  {/* Тип (Расход/Доход) */}
  <div className="form-field-group">
  <label className="form-label">Тип</label>
  <select
    name="type"
    value={formState.type}
    onChange={handleFormChange}
    className="form-input-select"
  >
    <option value="expense">Расход</option>
    <option value="income">Доход</option>
  </select>
  </div>

  {/* Сумма */}
  <div className="form-field-group">
  <label className="form-label" htmlFor="amount">Сумма (USD)</label>
  <input
    id="amount"
    name="amount"
    type="number"
    step="0.01"
    value={formState.amount}
    onChange={handleFormChange}
    placeholder="Например, 25.50"
    className="form-input-select"
    required
  />
  </div>

  {/* Дата */}
  <div className="form-field-group">
  <label className="form-label" htmlFor="date">Дата</label>
  <input
    id="date"
    name="date"
    type="date"
    value={formState.date}
    onChange={handleFormChange}
    className="form-input-select"
    required
  />
  </div>

  {/* Категория */}
  <div className="form-field-group">
  <label className="form-label" htmlFor="category_id">Категория</label>
  <select
    id="category_id"
    name="category_id"
    value={formState.category_id}
    onChange={handleFormChange}
    className="form-input-select"
    required
  >
    {categories.map((cat) => (
    <option key={cat.id} value={cat.id}>
    {cat.name}
    </option>
    ))}
  </select>
  </div>

  {/* Описание */}
  <div className="form-field-group">
  <label className="form-label" htmlFor="description">Описание (необязательно)</label>
  <input
    id="description"
    name="description"
    type="text"
    value={formState.description}
    onChange={handleFormChange}
    placeholder="Оплата в супермаркете"
    className="form-input-select"
  />
  </div>
  </div>

  <div className="form-actions">
  <button
  type="button"
  onClick={() => setIsModalOpen(false)}
  className="btn-cancel"
  >
  Отмена
  </button>
  <button
  type="submit"
  className="btn-submit"
  >
  {currentTransaction ? 'Сохранить изменения' : 'Создать транзакцию'}
  </button>
  </div>
  </form>

  </div>
  </div>
  )}
  </div>
  );
};

export default Transactions;