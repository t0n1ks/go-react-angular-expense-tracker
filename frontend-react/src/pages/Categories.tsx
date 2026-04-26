import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import { Plus, Edit, Trash2, Save, X } from 'lucide-react';
import DeleteSnackbar from '../components/DeleteSnackbar';
import './Categories.css';

interface Category {
  id: number;
  name: string;
}

const Categories: React.FC = () => {
  const { axiosInstance } = useAuth();
  const { t } = useTranslation();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [isEditing, setIsEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [formError, setFormError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<{ item: Category; index: number } | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await axiosInstance.get('/categories');
      setCategories(response.data.categories || []);
    } catch {
      setError(t('categories.error_load'));
    } finally {
      setLoading(false);
    }
  }, [axiosInstance, t]);

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
      setFormError(t('categories.error_create'));
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
      setFormError(t('categories.error_update'));
    }
  };

  const commitDelete = useCallback(async (id: number) => {
    try {
      await axiosInstance.delete(`/categories/${id}`);
    } catch {
      setFormError(t('categories.error_delete'));
    }
  }, [axiosInstance, t]);

  const handleDeleteCategory = useCallback(async (category: Category) => {
    if (pendingDelete) {
      clearTimeout(deleteTimerRef.current);
      await commitDelete(pendingDelete.item.id);
    }
    const index = categories.findIndex(c => c.id === category.id);
    setCategories(prev => prev.filter(c => c.id !== category.id));
    setPendingDelete({ item: category, index });
    deleteTimerRef.current = setTimeout(async () => {
      await commitDelete(category.id);
      setPendingDelete(null);
    }, 5500);
  }, [pendingDelete, categories, commitDelete]);

  const handleUndoDelete = useCallback(() => {
    clearTimeout(deleteTimerRef.current);
    if (pendingDelete) {
      setCategories(prev => {
        const next = [...prev];
        next.splice(pendingDelete.index, 0, pendingDelete.item);
        return next;
      });
      setPendingDelete(null);
    }
  }, [pendingDelete]);

  const handleSnackbarClose = useCallback(async () => {
    clearTimeout(deleteTimerRef.current);
    if (pendingDelete) {
      await commitDelete(pendingDelete.item.id);
      setPendingDelete(null);
    }
  }, [pendingDelete, commitDelete]);

  if (loading) return <div className="categories-wrapper">{t('common.loading')}</div>;

  return (
    <div className="categories-wrapper">
      <h1 className="categories-title">{t('categories.title')}</h1>

      {error && <div className="error-alert">{error}</div>}
      {formError && <div className="error-alert">{formError}</div>}

      <div className="category-card">
        <h2 className="category-card-title"><Plus size={20} style={{marginRight: '8px'}}/> {t('categories.add_title')}</h2>
        <form onSubmit={handleCreateCategory} className="category-form">
          <input
            type="text"
            className="category-input"
            value={categoryName}
            onChange={(e) => setCategoryName(e.target.value)}
            placeholder={t('categories.placeholder')}
          />
          <button type="submit" className="btn-create">{t('categories.create_btn')}</button>
        </form>
      </div>

      <div className="category-card">
        <h2 className="category-card-title">{t('categories.list_title', { count: categories.length })}</h2>
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
                    <button onClick={() => handleUpdateCategory(category.id)} className="action-btn save-btn" title={t('transactions.save_btn')}><Save size={18}/></button>
                    <button onClick={() => setIsEditing(null)} className="action-btn" title={t('transactions.cancel_btn')}><X size={18}/></button>
                  </div>
                </div>
              ) : (
                <>
                  <span className="category-name">{category.name}</span>
                  <div className="category-actions">
                    <button onClick={() => { setIsEditing(category.id); setEditName(category.name); }} className="action-btn edit-btn" title={t('common.edit') ?? 'Edit'}><Edit size={18}/></button>
                    <button onClick={() => handleDeleteCategory(category)} className="action-btn delete-btn" title={t('common.delete') ?? 'Delete'}><Trash2 size={18}/></button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>

      <DeleteSnackbar
        message={pendingDelete ? t('snackbar.category_deleted') : null}
        onUndo={handleUndoDelete}
        onClose={handleSnackbarClose}
      />
    </div>
  );
};

export default Categories;
