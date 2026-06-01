import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, ReceiptText, Pencil, X, Check, ChevronDown, FileDown } from 'lucide-react';
import DeleteSnackbar from '../components/DeleteSnackbar';
import TransactionDetailModal from '../components/TransactionDetailModal';
import {
  groupTransactionsByMonth,
  currentMonthKey,
  formatMonthLabel,
} from '../utils/groupTransactionsByMonth';
import './Transactions.css';

interface Category { id: number; name: string; }
interface Transaction {
  id: number;
  amount: number;
  date: string;
  created_at?: string;
  description: string;
  type: 'expense' | 'income' | 'savings_deposit' | 'savings_withdrawal';
  income_type?: string;
  category: Category;
}

const Transactions: React.FC = () => {
  const { axiosInstance } = useAuth();
  const { formatAmount, refreshCycle } = useSettings();
  const { t, i18n } = useTranslation();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPDFLoading, setIsPDFLoading] = useState(false);
  const [formState, setFormState] = useState({
    amount: '',
    date: new Date().toISOString().split('T')[0],
    description: '',
    category_id: '',
    type: 'expense',
    income_type: 'one_time',
  });
  const [formError, setFormError] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ item: Transaction; index: number } | null>(null);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [editState, setEditState] = useState({
    amount: '',
    date: '',
    description: '',
    category_id: '',
    type: 'expense' as 'expense' | 'income' | 'savings_deposit' | 'savings_withdrawal',
    income_type: 'one_time',
  });
  // Savings-pool transactions are edited in a restricted mode: only amount,
  // date and description are mutable. Type and category stay fixed so the entry
  // remains in the pool (the pool balance is derived from these rows).
  const isSavingsEdit =
    editState.type === 'savings_deposit' || editState.type === 'savings_withdrawal';

  // Accordion state — current month starts expanded, all historical months collapsed
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(
    () => new Set([currentMonthKey()]),
  );

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
      // silent — error_load shown via formError state if needed
    } finally {
      setLoading(false);
    }
  }, [axiosInstance, formState.category_id, t]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // When an edit begins, ensure the month containing that transaction is expanded
  // so the inline edit form is always visible.
  useEffect(() => {
    if (editingId === null) return;
    const tx = transactions.find(t => t.id === editingId);
    if (!tx) return;
    const [year, month] = tx.date.split('T')[0].split('-').map(Number);
    const key = `${year}-${String(month).padStart(2, '0')}`;
    setExpandedMonths(prev => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, [editingId, transactions]);

  const toggleMonth = useCallback((key: string) => {
    setExpandedMonths(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  const locale = i18n.resolvedLanguage ?? 'en';
  const groups = useMemo(() => groupTransactionsByMonth(transactions), [transactions]);

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
        category_id: parseInt(formState.category_id),
        income_type: formState.type === 'income' ? formState.income_type : undefined,
      };
      await axiosInstance.post('/transactions', payload);
      navigator.vibrate?.(10);
      setFormState(prev => ({ ...prev, amount: '', description: '' }));
      fetchData();
      refreshCycle(); // real-time: recompute cycle stats app-wide (cache-backed)
    } catch {
      setFormError(t('transactions.error_save'));
    }
  };

  const commitDelete = useCallback(async (id: number) => {
    try {
      await axiosInstance.delete(`/transactions/${id}`);
      refreshCycle(); // real-time: recompute cycle stats app-wide (cache-backed)
    } catch {
      setFormError(t('transactions.error_delete'));
    }
  }, [axiosInstance, t, refreshCycle]);

  const handleDelete = useCallback(async (tr: Transaction) => {
    // If a delete is already pending, commit it immediately before starting a new one
    if (pendingDelete) {
      clearTimeout(deleteTimerRef.current);
      await commitDelete(pendingDelete.item.id);
    }
    const index = transactions.findIndex(tx => tx.id === tr.id);
    setTransactions(prev => prev.filter(tx => tx.id !== tr.id));
    setPendingDelete({ item: tr, index });
    navigator.vibrate?.(10);
    deleteTimerRef.current = setTimeout(async () => {
      await commitDelete(tr.id);
      setPendingDelete(null);
    }, 5500);
  }, [pendingDelete, transactions, commitDelete]);

  const handleUndoDelete = useCallback(() => {
    clearTimeout(deleteTimerRef.current);
    if (pendingDelete) {
      setTransactions(prev => {
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

  const handleEditStart = (tr: Transaction) => {
    setEditingId(tr.id);
    setEditState({
      amount: tr.amount.toString(),
      date: tr.date.split('T')[0],
      description: tr.description,
      category_id: tr.category?.id.toString() ?? '',
      // Preserve the real type — savings rows keep savings_deposit/withdrawal so
      // the update stays in the pool instead of being converted to income/expense.
      type: tr.type,
      income_type: tr.income_type || 'one_time',
    });
  };

  const handleUpdate = async (id: number) => {
    setFormError('');
    try {
      // For savings-pool rows send ONLY the mutable fields. Omitting type and
      // category_id makes the backend preserve them (PUT uses pointer fields),
      // so the row stays in the pool and the derived balance updates correctly.
      const payload = isSavingsEdit
        ? {
            amount: parseFloat(editState.amount),
            date: editState.date,
            description: editState.description,
          }
        : {
            ...editState,
            amount: parseFloat(editState.amount),
            category_id: parseInt(editState.category_id),
            income_type: editState.type === 'income' ? editState.income_type : undefined,
          };
      await axiosInstance.put(`/transactions/${id}`, payload);
      setEditingId(null);
      fetchData();
      refreshCycle(); // real-time: recompute cycle stats app-wide (cache-backed)
    } catch {
      setFormError(t('transactions.error_update'));
    }
  };

  const handleCancelEdit = () => setEditingId(null);

  const handleExportPDF = useCallback(async () => {
    if (isPDFLoading) return;
    setIsPDFLoading(true);
    try {
      const lang = (i18n.resolvedLanguage ?? 'en').split('-')[0];
      const response = await axiosInstance.get(`/transactions/export/pdf?language=${lang}`, {
        responseType: 'blob',
      });
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'transactions.pdf';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      setFormError(t('transactions.error_load'));
    } finally {
      setIsPDFLoading(false);
    }
  }, [axiosInstance, t, isPDFLoading]);

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

          {formState.type === 'income' && (
            <div className="income-type-row">
              <span className="income-type-label">{t('transactions.income_type')}:</span>
              <div className="income-type-pills">
                <button
                  type="button"
                  className={`income-pill${formState.income_type === 'one_time' ? ' income-pill--active' : ''}`}
                  onClick={() => setFormState(prev => ({ ...prev, income_type: 'one_time' }))}
                >
                  {t('transactions.income_type_full')}
                </button>
                <button
                  type="button"
                  className={`income-pill${formState.income_type === 'part' ? ' income-pill--active' : ''}`}
                  onClick={() => setFormState(prev => ({ ...prev, income_type: 'part' }))}
                >
                  {t('transactions.income_type_part')}
                </button>
              </div>
            </div>
          )}

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

          <div className="form-group form-group--full">
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
          <button
            className="btn-export-pdf"
            onClick={handleExportPDF}
            disabled={transactions.length === 0 || isPDFLoading}
            title={t('transactions.export_pdf')}
          >
            <FileDown size={16}/>
            <span className="btn-export-label">
              {isPDFLoading ? '…' : t('transactions.export_pdf')}
            </span>
          </button>
        </div>

        {/* ── Desktop table ──────────────────────────────────────────────────── */}
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

            {groups.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={6} style={{textAlign: 'center', padding: '2rem', color: '#94a3b8'}}>
                    {t('transactions.no_transactions')}
                  </td>
                </tr>
              </tbody>
            ) : (
              groups.map(group => {
                const isExpanded = expandedMonths.has(group.key);
                const monthIncome = group.transactions
                  .filter(t => t.type === 'income')
                  .reduce((s, t) => s + Number(t.amount), 0);
                const monthExpense = group.transactions
                  .filter(t => t.type === 'expense')
                  .reduce((s, t) => s + Number(t.amount), 0);
                const label = formatMonthLabel(group.year, group.month, locale);

                return (
                  <React.Fragment key={group.key}>
                    {/* Month separator / accordion trigger */}
                    <tbody className="month-header-tbody">
                      <tr
                        className="month-header-row"
                        onClick={() => toggleMonth(group.key)}
                        aria-expanded={isExpanded}
                      >
                        <td colSpan={6}>
                          <div className="month-header-inner">
                            <ChevronDown
                              size={15}
                              className={`month-chevron${isExpanded ? ' month-chevron--open' : ''}`}
                            />
                            <span className="month-header-label">{label}</span>
                            <span className="month-header-count">{group.transactions.length}</span>
                            <span className="month-header-amounts">
                              {monthIncome > 0 && (
                                <span className="month-header-income">+{formatAmount(monthIncome)}</span>
                              )}
                              {monthExpense > 0 && (
                                <span className="month-header-expense">−{formatAmount(monthExpense)}</span>
                              )}
                            </span>
                          </div>
                        </td>
                      </tr>
                    </tbody>

                    {/* Transaction rows — hidden when collapsed */}
                    <tbody className={`month-txns-tbody${isExpanded ? '' : ' month-txns-tbody--hidden'}`}>
                      {group.transactions.map(tr => (
                        editingId === tr.id ? (
                          <tr key={tr.id} className="edit-row edit-row--form">
                            {/* Break out of the rigid 6-column grid: a single
                                full-width cell with a flex-wrap layout so the
                                inputs never overlap and reflow cleanly on any
                                desktop width. */}
                            <td colSpan={6}>
                              <div className="edit-grid">
                                <div className="edit-field edit-field--date">
                                  <label className="edit-field-label">{t('transactions.date')}</label>
                                  <input type="date" className="form-input edit-input" value={editState.date}
                                    onChange={e => setEditState({...editState, date: e.target.value})}/>
                                </div>

                                {!isSavingsEdit && (
                                  <div className="edit-field edit-field--category">
                                    <label className="edit-field-label">{t('transactions.category')}</label>
                                    <select className="form-input edit-input" value={editState.category_id}
                                      onChange={e => setEditState({...editState, category_id: e.target.value})}>
                                      {categories.map(c => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                      ))}
                                    </select>
                                  </div>
                                )}

                                <div className="edit-field edit-field--desc">
                                  <label className="edit-field-label">{t('transactions.description')}</label>
                                  <input type="text" className="form-input edit-input" value={editState.description}
                                    onChange={e => setEditState({...editState, description: e.target.value})}
                                    placeholder={t('transactions.description')}/>
                                </div>

                                <div className="edit-field edit-field--type">
                                  <label className="edit-field-label">{t('transactions.type')}</label>
                                  {isSavingsEdit ? (
                                    <span className={`edit-savings-badge ${editState.type === 'savings_deposit' ? 'type-income' : 'type-expense'}`}>
                                      {editState.type === 'savings_deposit' ? t('dashboard.savings_deposit') : t('dashboard.savings_withdraw')}
                                    </span>
                                  ) : (
                                    <>
                                      <select className="form-input edit-input" value={editState.type}
                                        onChange={e => {
                                          const v = e.target.value;
                                          if (v === 'expense' || v === 'income') setEditState({...editState, type: v});
                                        }}>
                                        <option value="expense">{t('transactions.type_expense')}</option>
                                        <option value="income">{t('transactions.type_income')}</option>
                                      </select>
                                      {editState.type === 'income' && (
                                        <div className="edit-income-type">
                                          <button type="button"
                                            className={`edit-income-pill${editState.income_type === 'one_time' ? ' edit-income-pill--active' : ''}`}
                                            onClick={() => setEditState(prev => ({ ...prev, income_type: 'one_time' }))}>
                                            {t('transactions.income_type_full')}
                                          </button>
                                          <button type="button"
                                            className={`edit-income-pill${editState.income_type === 'part' ? ' edit-income-pill--active' : ''}`}
                                            onClick={() => setEditState(prev => ({ ...prev, income_type: 'part' }))}>
                                            {t('transactions.income_type_part')}
                                          </button>
                                        </div>
                                      )}
                                    </>
                                  )}
                                </div>

                                <div className="edit-field edit-field--amount">
                                  <label className="edit-field-label">{t('transactions.amount')}</label>
                                  <input type="number" className="form-input edit-input" value={editState.amount}
                                    onChange={e => setEditState({...editState, amount: e.target.value})}
                                    step="0.01" min="0.01"/>
                                </div>

                                <div className="edit-actions edit-actions--form">
                                  <button onClick={() => handleUpdate(tr.id)} className="action-btn save" title={t('transactions.save_btn')}>
                                    <Check size={18}/>
                                  </button>
                                  <button onClick={handleCancelEdit} className="action-btn cancel" title={t('transactions.cancel_btn')}>
                                    <X size={18}/>
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          <tr key={tr.id} className="tx-row-clickable" onClick={() => setSelectedTx(tr)}>
                            <td>{new Date(tr.date).toLocaleDateString()}</td>
                            <td><span className="category-tag">{tr.category?.name || t('transactions.no_category')}</span></td>
                            <td>{tr.description || '—'}</td>
                            <td>
                              <span className={`type-badge ${tr.type === 'income' || tr.type === 'savings_deposit' ? 'type-income' : 'type-expense'}`}>
                                {tr.type === 'income' ? t('transactions.type_income') : tr.type === 'expense' ? t('transactions.type_expense') : tr.type === 'savings_deposit' ? t('transactions.type_income') : t('transactions.type_expense')}
                              </span>
                            </td>
                            <td className={tr.type === 'income' || tr.type === 'savings_deposit' ? 'amount-income' : 'amount-expense'}>
                              {tr.type === 'income' || tr.type === 'savings_deposit' ? '+' : '-'}{formatAmount(tr.amount)}
                            </td>
                            <td>
                              <button onClick={(e) => { e.stopPropagation(); handleEditStart(tr); }} className="action-btn edit" title={t('common.edit') ?? 'Edit'}>
                                <Pencil size={18}/>
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); handleDelete(tr); }} className="action-btn delete" title={t('common.delete') ?? 'Delete'}>
                                <Trash2 size={18}/>
                              </button>
                            </td>
                          </tr>
                        )
                      ))}
                    </tbody>
                  </React.Fragment>
                );
              })
            )}
          </table>
        </div>

        {/* ── Mobile accordion list ───────────────────────────────────────── */}
        <div className="tx-cards-mobile">
          {groups.length === 0 ? (
            <p className="tx-cards-empty">{t('transactions.no_transactions')}</p>
          ) : (
            groups.map(group => {
              const isExpanded = expandedMonths.has(group.key);
              const monthIncomeM = group.transactions
                .filter(t => t.type === 'income')
                .reduce((s, t) => s + Number(t.amount), 0);
              const monthExpenseM = group.transactions
                .filter(t => t.type === 'expense')
                .reduce((s, t) => s + Number(t.amount), 0);
              const label = formatMonthLabel(group.year, group.month, locale);

              return (
                <div key={group.key} className="month-accordion">
                  <button
                    className="month-accordion-btn"
                    onClick={() => toggleMonth(group.key)}
                    aria-expanded={isExpanded}
                    aria-controls={`month-content-${group.key}`}
                  >
                    <div className="month-accordion-left">
                      <ChevronDown
                        size={18}
                        className={`month-chevron${isExpanded ? ' month-chevron--open' : ''}`}
                      />
                      <span className="month-accordion-label">{label}</span>
                    </div>
                    <div className="month-accordion-right">
                      <span className="month-accordion-count">{group.transactions.length}</span>
                      <span className="month-accordion-amounts">
                        {monthIncomeM > 0 && (
                          <span className="month-accordion-income">+{formatAmount(monthIncomeM)}</span>
                        )}
                        {monthExpenseM > 0 && (
                          <span className="month-accordion-expense">−{formatAmount(monthExpenseM)}</span>
                        )}
                      </span>
                    </div>
                  </button>

                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div
                        key="content"
                        id={`month-content-${group.key}`}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                        style={{ overflow: 'hidden' }}
                      >
                        <div className="month-accordion-body">
                          {group.transactions.map(tr => (
                            <div
                              key={tr.id}
                              className="tx-card-item"
                              onClick={() => { if (editingId !== tr.id) setSelectedTx(tr); }}
                              style={{ cursor: editingId === tr.id ? 'default' : 'pointer' }}
                            >
                              {editingId === tr.id ? (
                                <div className="tx-card-edit">
                                  <div className="tx-card-edit-field">
                                    <label className="tx-card-edit-label">{t('transactions.date')}</label>
                                    <input type="date" className="form-input tx-card-edit-input" value={editState.date}
                                      onChange={e => setEditState({...editState, date: e.target.value})}/>
                                  </div>
                                  <div className="tx-card-edit-field">
                                    <label className="tx-card-edit-label">{t('transactions.amount')}</label>
                                    <input type="number" className="form-input tx-card-edit-input" value={editState.amount}
                                      onChange={e => setEditState({...editState, amount: e.target.value})} step="0.01" min="0.01"/>
                                  </div>
                                  {isSavingsEdit ? (
                                    <div className="tx-card-edit-field">
                                      <label className="tx-card-edit-label">{t('transactions.type')}</label>
                                      <span className={`edit-savings-badge ${editState.type === 'savings_deposit' ? 'type-income' : 'type-expense'}`}>
                                        {editState.type === 'savings_deposit' ? t('dashboard.savings_deposit') : t('dashboard.savings_withdraw')}
                                      </span>
                                    </div>
                                  ) : (
                                    <>
                                      <div className="tx-card-edit-field">
                                        <label className="tx-card-edit-label">{t('transactions.type')}</label>
                                        <select className="form-input tx-card-edit-input" value={editState.type}
                                          onChange={e => { const v = e.target.value; if (v === 'expense' || v === 'income') setEditState({...editState, type: v}); }}>
                                          <option value="expense">{t('transactions.type_expense')}</option>
                                          <option value="income">{t('transactions.type_income')}</option>
                                        </select>
                                        {editState.type === 'income' && (
                                          <div className="edit-income-type">
                                            <button type="button"
                                              className={`edit-income-pill${editState.income_type === 'one_time' ? ' edit-income-pill--active' : ''}`}
                                              onClick={() => setEditState(prev => ({ ...prev, income_type: 'one_time' }))}>
                                              {t('transactions.income_type_full')}
                                            </button>
                                            <button type="button"
                                              className={`edit-income-pill${editState.income_type === 'part' ? ' edit-income-pill--active' : ''}`}
                                              onClick={() => setEditState(prev => ({ ...prev, income_type: 'part' }))}>
                                              {t('transactions.income_type_part')}
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                      <div className="tx-card-edit-field">
                                        <label className="tx-card-edit-label">{t('transactions.category')}</label>
                                        <select className="form-input tx-card-edit-input" value={editState.category_id}
                                          onChange={e => setEditState({...editState, category_id: e.target.value})}>
                                          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        </select>
                                      </div>
                                    </>
                                  )}
                                  <div className="tx-card-edit-field">
                                    <label className="tx-card-edit-label">{t('transactions.description')}</label>
                                    <input type="text" className="form-input tx-card-edit-input" value={editState.description}
                                      onChange={e => setEditState({...editState, description: e.target.value})}
                                      placeholder={t('transactions.desc_ph')}/>
                                  </div>
                                  <div className="tx-card-edit-actions">
                                    <button onClick={() => handleUpdate(tr.id)} className="tx-card-edit-btn tx-card-edit-btn--save">
                                      <Check size={16}/>{t('transactions.save_btn')}
                                    </button>
                                    <button onClick={handleCancelEdit} className="tx-card-edit-btn tx-card-edit-btn--cancel">
                                      <X size={16}/>{t('transactions.cancel_btn')}
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className="tx-card-top">
                                    <span className="tx-card-category">{tr.category?.name || t('transactions.no_category')}</span>
                                    <span className={`tx-card-amount ${tr.type === 'income' || tr.type === 'savings_deposit' ? 'amount-income' : 'amount-expense'}`}>
                                      {tr.type === 'income' || tr.type === 'savings_deposit' ? '+' : '-'}{formatAmount(tr.amount)}
                                    </span>
                                  </div>
                                  <div className="tx-card-meta">
                                    <span className="tx-card-date">{new Date(tr.date).toLocaleDateString()}</span>
                                    {tr.description && <span className="tx-card-desc">{tr.description}</span>}
                                  </div>
                                  <div className="tx-card-actions">
                                    <button onClick={(e) => { e.stopPropagation(); handleEditStart(tr); }} className="action-btn edit"><Pencil size={16}/></button>
                                    <button onClick={(e) => { e.stopPropagation(); handleDelete(tr); }} className="action-btn delete"><Trash2 size={16}/></button>
                                  </div>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })
          )}
        </div>
      </div>

      <DeleteSnackbar
        message={pendingDelete ? t('snackbar.transaction_deleted') : null}
        onUndo={handleUndoDelete}
        onClose={handleSnackbarClose}
      />

      <TransactionDetailModal
        tx={selectedTx}
        onClose={() => setSelectedTx(null)}
      />
    </div>
  );
};

export default Transactions;
