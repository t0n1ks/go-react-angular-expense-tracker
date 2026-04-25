import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { Plus, Trash2, ReceiptText, Pencil, X, Check } from 'lucide-react';
import './Transactions.css';

interface Category { id: number; name: string; }
interface Transaction {
  id: number;
  amount: number;
  date: string;
  description: string;
  type: 'expense' | 'income';
  category: Category;
}

const Transactions: React.FC = () => {
  const { axiosInstance } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [formState, setFormState] = useState({
    amount: '',
    date: new Date().toISOString().split('T')[0],
    description: '',
    category_id: '',
    type: 'expense'
  });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editState, setEditState] = useState({
    amount: '',
    date: '',
    description: '',
    category_id: '',
    type: 'expense' as 'expense' | 'income'
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [transRes, catsRes] = await Promise.all([
        axiosInstance.get('/transactions'),
        axiosInstance.get('/categories')
      ]);
      setTransactions(transRes.data.transactions || []);
      const cats = catsRes.data.categories || [];
      setCategories(cats);
      if (cats.length > 0 && !formState.category_id) {
        setFormState(prev => ({ ...prev, category_id: cats[0].id.toString() }));
      }
    } catch {
      console.error("Ошибка загрузки данных");
    } finally {
      setLoading(false);
    }
  }, [axiosInstance, formState.category_id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState.category_id) {
      alert("Сначала создайте категорию!");
      return;
    }
    try {
      const payload = {
        ...formState,
        amount: parseFloat(formState.amount),
        category_id: parseInt(formState.category_id)
      };
      await axiosInstance.post('/transactions', payload);
      setFormState(prev => ({ ...prev, amount: '', description: '' }));
      fetchData();
    } catch {
      alert("Ошибка при сохранении");
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("Удалить транзакцию?")) return;
    try {
      await axiosInstance.delete(`/transactions/${id}`);
      setTransactions(prev => prev.filter(t => t.id !== id));
    } catch {
      alert("Ошибка при удалении");
    }
  };

  const handleEditStart = (t: Transaction) => {
    setEditingId(t.id);
    setEditState({
      amount: t.amount.toString(),
      date: t.date.split('T')[0],
      description: t.description,
      category_id: t.category?.id.toString() ?? '',
      type: t.type
    });
  };

  const handleUpdate = async (id: number) => {
    try {
      const payload = {
        ...editState,
        amount: parseFloat(editState.amount),
        category_id: parseInt(editState.category_id)
      };
      await axiosInstance.put(`/transactions/${id}`, payload);
      setEditingId(null);
      fetchData();
    } catch {
      alert("Ошибка при обновлении");
    }
  };

  const handleCancelEdit = () => setEditingId(null);

  if (loading) return <div className="transactions-wrapper">Загрузка...</div>;

  return (
    <div className="transactions-wrapper">
      <h1 className="transactions-title">Транзакции</h1>

      <div className="transaction-card">
        <div className="card-title"><Plus size={20} style={{marginRight: '8px'}}/> Новая запись</div>
        <form onSubmit={handleSubmit} className="transaction-form-grid">
          <div className="form-group">
            <label>Сумма</label>
            <input type="number" className="form-input" value={formState.amount}
              onChange={e => setFormState({...formState, amount: e.target.value})} required step="0.01"/>
          </div>

          <div className="form-group">
            <label>Тип</label>
            <select
        className="form-input"
           value={formState.type}
          onChange={e => {
            const value = e.target.value;
         if (value === 'expense' || value === 'income') {
             setFormState({ ...formState, type: value });
             }
          }}
>
  <option value="expense">Расход</option>
  <option value="income">Доход</option>
</select>
          </div>

          <div className="form-group">
            <label>Дата</label>
            <input type="date" className="form-input" value={formState.date} onChange={e => setFormState({...formState, date: e.target.value})} required/>
          </div>

          <div className="form-group">
            <label>Категория</label>
            <select
              className="form-input"
              value={formState.category_id}
              onChange={e => setFormState({...formState, category_id: e.target.value})}
              required
            >
              <option value="" disabled>Выберите категорию</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{gridColumn: 'span 2'}}>
            <label>Описание</label>
            <input type="text" className="form-input" value={formState.description}
              onChange={e => setFormState({...formState, description: e.target.value})} placeholder="На что потратили?"/>
          </div>

          <button type="submit" className="btn-add-transaction">Добавить</button>
        </form>
      </div>

      <div className="transaction-card">
        <div className="card-header">
          <div className="card-title"><ReceiptText size={20} style={{marginRight: '8px'}}/> История операций</div>
        </div>
        <div className="table-container">
          <table className="styled-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Категория</th>
                <th>Описание</th>
                <th>Тип</th>
                <th>Сумма</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{textAlign: 'center', padding: '2rem', color: '#94a3b8'}}>Транзакций пока нет</td>
                </tr>
              ) : (
                transactions.map(t => (
                  editingId === t.id ? (
                    <tr key={t.id} className="edit-row">
                      <td>
                        <input type="date" className="form-input edit-input" value={editState.date}
                          onChange={e => setEditState({...editState, date: e.target.value})}/>
                      </td>
                      <td>
                        <select className="form-input edit-input" value={editState.category_id}
                          onChange={e => setEditState({...editState, category_id: e.target.value})}>
                          {categories.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input type="text" className="form-input edit-input" value={editState.description}
                          onChange={e => setEditState({...editState, description: e.target.value})}
                          placeholder="Описание"/>
                      </td>
                      <td>
                        <select className="form-input edit-input" value={editState.type}
                          onChange={e => {
                            const v = e.target.value;
                            if (v === 'expense' || v === 'income') setEditState({...editState, type: v});
                          }}>
                          <option value="expense">Расход</option>
                          <option value="income">Доход</option>
                        </select>
                      </td>
                      <td>
                        <input type="number" className="form-input edit-input" value={editState.amount}
                          onChange={e => setEditState({...editState, amount: e.target.value})}
                          step="0.01" min="0.01"/>
                      </td>
                      <td className="edit-actions">
                        <button onClick={() => handleUpdate(t.id)} className="action-btn save" title="Сохранить">
                          <Check size={18}/>
                        </button>
                        <button onClick={handleCancelEdit} className="action-btn cancel" title="Отмена">
                          <X size={18}/>
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={t.id}>
                      <td>{new Date(t.date).toLocaleDateString()}</td>
                      <td><span className="category-tag">{t.category?.name || 'Без категории'}</span></td>
                      <td>{t.description || '—'}</td>
                      <td>
                        <span className={`type-badge ${t.type === 'income' ? 'type-income' : 'type-expense'}`}>
                          {t.type === 'income' ? 'Доход' : 'Расход'}
                        </span>
                      </td>
                      <td className={t.type === 'income' ? 'amount-income' : 'amount-expense'}>
                        {t.type === 'income' ? '+' : '-'}${Math.abs(t.amount).toLocaleString()}
                      </td>
                      <td>
                        <button onClick={() => handleEditStart(t)} className="action-btn edit" title="Редактировать">
                          <Pencil size={18}/>
                        </button>
                        <button onClick={() => handleDelete(t.id)} className="action-btn delete" title="Удалить">
                          <Trash2 size={18}/>
                        </button>
                      </td>
                    </tr>
                  )
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Transactions;
