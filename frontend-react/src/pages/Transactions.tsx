import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useTranslation } from 'react-i18next';
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
  const { formatAmount } = useSettings();
  const { t } = useTranslation();
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
  const [formError, setFormError] = useState('');
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
      console.error(t('transactions.error_load'));
    } finally {
      setLoading(false);
    }
  }, [axiosInstance, formState.category_id, t]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState.category_id) {
      setFormError(t('transactions.error_no_cat'));
      return;
    }
    setFormError('');
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
      setFormError(t('transactions.error_save'));
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm(t('transactions.confirm_delete'))) return;
    setFormError('');
    try {
      await axiosInstance.delete(`/transactions/${id}`);
      setTransactions(prev => prev.filter(tr => tr.id !== id));
    } catch {
      setFormError(t('transactions.error_delete'));
    }
  };

  const handleEditStart = (tr: Transaction) => {
    setEditingId(tr.id);
    setEditState({
      amount: tr.amount.toString(),
      date: tr.date.split('T')[0],
      description: tr.description,
      category_id: tr.category?.id.toString() ?? '',
      type: tr.type
    });
  };

  const handleUpdate = async (id: number) => {
    setFormError('');
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
      setFormError(t('transactions.error_update'));
    }
  };

  const handleCancelEdit = () => setEditingId(null);

  if (loading) return <div className="transactions-wrapper">{t('common.loading')}</div>;

  return (
    <div className="transactions-wrapper">
      <h1 className="transactions-title">{t('transactions.title')}</h1>

      {formError && <div className="error-alert">{formError}</div>}

      <div className="transaction-card">
        <div className="card-title"><Plus size={20} style={{marginRight: '8px'}}/> {t('transactions.new_record')}</div>
        <form onSubmit={handleSubmit} className="transaction-form-grid">
          <div className="form-group">
            <label>{t('transactions.amount')}</label>
            <input type="number" className="form-input" value={formState.amount}
              onChange={e => setFormState({...formState, amount: e.target.value})} required step="0.01"/>
          </div>

          <div className="form-group">
            <label>{t('transactions.type')}</label>
            <select className="form-input" value={formState.type}
              onChange={e => {
                const value = e.target.value;
                if (value === 'expense' || value === 'income') {
                  setFormState({ ...formState, type: value });
                }
              }}>
              <option value="expense">{t('transactions.type_expense')}</option>
              <option value="income">{t('transactions.type_income')}</option>
            </select>
          </div>

          <div className="form-group">
            <label>{t('transactions.date')}</label>
            <input type="date" className="form-input" value={formState.date}
              onChange={e => setFormState({...formState, date: e.target.value})} required/>
          </div>

          <div className="form-group">
            <label>{t('transactions.category')}</label>
            <select className="form-input" value={formState.category_id}
              onChange={e => setFormState({...formState, category_id: e.target.value})} required>
              <option value="" disabled>{t('transactions.select_cat')}</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{gridColumn: 'span 2'}}>
            <label>{t('transactions.description')}</label>
            <input type="text" className="form-input" value={formState.description}
              onChange={e => setFormState({...formState, description: e.target.value})}
              placeholder={t('transactions.desc_ph')}/>
          </div>

          <button type="submit" className="btn-add-transaction">{t('transactions.add_btn')}</button>
        </form>
      </div>

      <div className="transaction-card">
        <div className="card-header">
          <div className="card-title"><ReceiptText size={20} style={{marginRight: '8px'}}/> {t('transactions.history')}</div>
        </div>
        <div className="table-container">
          <table className="styled-table">
            <thead>
              <tr>
                <th>{t('transactions.col_date')}</th>
                <th>{t('transactions.col_category')}</th>
                <th>{t('transactions.col_description')}</th>
                <th>{t('transactions.col_type')}</th>
                <th>{t('transactions.col_amount')}</th>
                <th>{t('transactions.col_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{textAlign: 'center', padding: '2rem', color: '#94a3b8'}}>
                    {t('transactions.no_transactions')}
                  </td>
                </tr>
              ) : (
                transactions.map(tr => (
                  editingId === tr.id ? (
                    <tr key={tr.id} className="edit-row">
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
                          placeholder={t('transactions.description')}/>
                      </td>
                      <td>
                        <select className="form-input edit-input" value={editState.type}
                          onChange={e => {
                            const v = e.target.value;
                            if (v === 'expense' || v === 'income') setEditState({...editState, type: v});
                          }}>
                          <option value="expense">{t('transactions.type_expense')}</option>
                          <option value="income">{t('transactions.type_income')}</option>
                        </select>
                      </td>
                      <td>
                        <input type="number" className="form-input edit-input" value={editState.amount}
                          onChange={e => setEditState({...editState, amount: e.target.value})}
                          step="0.01" min="0.01"/>
                      </td>
                      <td className="edit-actions">
                        <button onClick={() => handleUpdate(tr.id)} className="action-btn save" title={t('transactions.save_btn')}>
                          <Check size={18}/>
                        </button>
                        <button onClick={handleCancelEdit} className="action-btn cancel" title={t('transactions.cancel_btn')}>
                          <X size={18}/>
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={tr.id}>
                      <td>{new Date(tr.date).toLocaleDateString()}</td>
                      <td><span className="category-tag">{tr.category?.name || t('transactions.no_category')}</span></td>
                      <td>{tr.description || '—'}</td>
                      <td>
                        <span className={`type-badge ${tr.type === 'income' ? 'type-income' : 'type-expense'}`}>
                          {tr.type === 'income' ? t('transactions.type_income') : t('transactions.type_expense')}
                        </span>
                      </td>
                      <td className={tr.type === 'income' ? 'amount-income' : 'amount-expense'}>
                        {tr.type === 'income' ? '+' : '-'}{formatAmount(tr.amount)}
                      </td>
                      <td>
                        <button onClick={() => handleEditStart(tr)} className="action-btn edit" title={t('common.edit') ?? 'Edit'}>
                          <Pencil size={18}/>
                        </button>
                        <button onClick={() => handleDelete(tr.id)} className="action-btn delete" title={t('common.delete') ?? 'Delete'}>
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
