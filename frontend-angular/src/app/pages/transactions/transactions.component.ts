import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { forkJoin } from 'rxjs';
import { TransactionService } from '../../services/transaction.service';
import { type Transaction, type Category, type TransactionPayload } from '../../models/transaction.model';

@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [FormsModule, TranslateModule],
  templateUrl: './transactions.component.html',
  styleUrl: './transactions.component.css'
})
export class TransactionsComponent implements OnInit {
  transactions = signal<Transaction[]>([]);
  categories = signal<Category[]>([]);
  loading = signal(true);
  editingId = signal<number | null>(null);

  formState = {
    amount: '',
    date: new Date().toISOString().split('T')[0],
    description: '',
    category_id: '',
    type: 'expense' as 'expense' | 'income'
  };

  editState = {
    amount: '',
    date: '',
    description: '',
    category_id: '',
    type: 'expense' as 'expense' | 'income'
  };

  constructor(private svc: TransactionService) {}

  ngOnInit(): void {
    this.loadData();
  }

  loadData(): void {
    this.loading.set(true);
    forkJoin({
      transactions: this.svc.getTransactions(),
      categories: this.svc.getCategories()
    }).subscribe({
      next: (res) => {
        this.transactions.set(res.transactions.transactions || []);
        const cats = res.categories.categories || [];
        this.categories.set(cats);
        if (cats.length > 0 && !this.formState.category_id) {
          this.formState.category_id = cats[0].id.toString();
        }
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  handleSubmit(): void {
    if (!this.formState.category_id) {
      alert('Please create a category first!');
      return;
    }
    const payload: TransactionPayload = {
      amount: parseFloat(this.formState.amount),
      date: this.formState.date,
      description: this.formState.description,
      category_id: parseInt(this.formState.category_id),
      type: this.formState.type
    };
    this.svc.createTransaction(payload).subscribe({
      next: () => {
        this.formState.amount = '';
        this.formState.description = '';
        this.loadData();
      },
      error: () => alert('Error saving transaction')
    });
  }

  handleDelete(id: number): void {
    if (!confirm('Delete this transaction?')) return;
    this.svc.deleteTransaction(id).subscribe({
      next: () => this.transactions.update(list => list.filter(t => t.id !== id)),
      error: () => alert('Error deleting transaction')
    });
  }

  handleEditStart(t: Transaction): void {
    this.editingId.set(t.id);
    this.editState = {
      amount: t.amount.toString(),
      date: t.date.split('T')[0],
      description: t.description,
      category_id: t.category?.id.toString() ?? '',
      type: t.type
    };
  }

  handleUpdate(id: number): void {
    const payload: TransactionPayload = {
      amount: parseFloat(this.editState.amount),
      date: this.editState.date,
      description: this.editState.description,
      category_id: parseInt(this.editState.category_id),
      type: this.editState.type
    };
    this.svc.updateTransaction(id, payload).subscribe({
      next: () => {
        this.editingId.set(null);
        this.loadData();
      },
      error: () => alert('Error updating transaction')
    });
  }

  handleCancelEdit(): void {
    this.editingId.set(null);
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString();
  }

  formatAmount(amount: number): string {
    return Math.abs(amount).toLocaleString();
  }
}
