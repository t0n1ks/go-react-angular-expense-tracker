import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { Plus, Edit, Trash2, Save, X } from 'lucide-react';
import './Categories.css';

interface Category {
  id: number;
  name: string;
}

const Categories: React.FC = () => {
  const { axiosInstance } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(''); // Теперь будем использовать это состояние
  const [categoryName, setCategoryName] = useState('');
  const [isEditing, setIsEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [formError, setFormError] = useState('');

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    setError(''); // Сбрасываем ошибку перед загрузкой
    try {
      const response = await axiosInstance.get('/categories');
      setCategories(response.data.categories || []);
    } catch {
      setError("Не удалось загрузить категории. Проверьте соединение с сервером.");
    } finally {
      setLoading(false);
    }
  }, [axiosInstance]);

  useEffect(() => { fetchCategories(); }, [fetchCategories]);

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoryName.trim()) return;
    setFormError('');
    try {
      const response = await axiosInstance.post('/categories', { name: categoryName.trim() });
      setCategories((prev) => [...prev, response.data.category]);
      setCategoryName('');
    } catch {
      setFormError("Ошибка при создании категории.");
    }
  };

  const handleUpdateCategory = async (categoryId: number) => {
    if (!editName.trim()) return;
    setFormError('');
    try {
      const response = await axiosInstance.put(`/categories/${categoryId}`, { name: editName.trim() });
      setCategories((prev) => prev.map((cat) => (cat.id === categoryId ? response.data.category : cat)));
      setIsEditing(null);
    } catch {
      setFormError("Ошибка при обновлении названия.");
    }
  };

  const handleDeleteCategory = async (categoryId: number) => {
    if (!window.confirm("Удалить эту категорию?")) return;
    setFormError('');
    try {
      await axiosInstance.delete(`/categories/${categoryId}`);
      setCategories((prev) => prev.filter((cat) => cat.id !== categoryId));
    } catch {
      setFormError("Не удалось удалить. Возможно, категория используется в транзакциях.");
    }
  };

  if (loading) return <div className="categories-wrapper">Загрузка...</div>;

  return (
    <div className="categories-wrapper">
      <h1 className="categories-title">Управление категориями</h1>

      {/* Используем состояние error, чтобы TS не ругался */}
      {error && <div className="error-alert">{error}</div>}
      {formError && <div className="error-alert">{formError}</div>}

      <div className="category-card">
        <h2 className="category-card-title"><Plus size={20} style={{marginRight: '8px'}}/> Добавить категорию</h2>
        <form onSubmit={handleCreateCategory} className="category-form">
          <input
            type="text"
            className="category-input"
            value={categoryName}
            onChange={(e) => setCategoryName(e.target.value)}
            placeholder="Например: Еда, Транспорт..."
          />
          <button type="submit" className="btn-create">Создать</button>
        </form>
      </div>

      <div className="category-card">
        <h2 className="category-card-title">Ваши категории ({categories.length})</h2>
        <ul className="categories-list">
          {categories.map((category) => (
            <li key={category.id} className="category-item">
              {isEditing === category.id ? (
                <div className="category-form" style={{width: '100%'}}>
                  <input
                    type="text"
                    className="category-input"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                  <div className="category-actions">
                    <button onClick={() => handleUpdateCategory(category.id)} className="action-btn save-btn" title="Сохранить"><Save size={18}/></button>
                    <button onClick={() => setIsEditing(null)} className="action-btn" title="Отмена"><X size={18}/></button>
                  </div>
                </div>
              ) : (
                <>
                  <span className="category-name">{category.name}</span>
                  <div className="category-actions">
                    <button onClick={() => { setIsEditing(category.id); setEditName(category.name); }} className="action-btn edit-btn" title="Редактировать"><Edit size={18}/></button>
                    <button onClick={() => handleDeleteCategory(category.id)} className="action-btn delete-btn" title="Удалить"><Trash2 size={18}/></button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default Categories;