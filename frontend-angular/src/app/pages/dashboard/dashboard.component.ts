import { Component, OnInit, signal, computed } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { TransactionService } from '../../services/transaction.service';
import { type Transaction } from '../../models/transaction.model';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [TranslateModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit {
  transactions = signal<Transaction[]>([]);
  loading = signal(true);

  totalIncome = computed(() =>
    this.transactions().filter(t => t.type === 'income').reduce((acc, t) => acc + Number(t.amount), 0)
  );

  totalExpense = computed(() =>
    this.transactions().filter(t => t.type === 'expense').reduce((acc, t) => acc + Number(t.amount), 0)
  );

  balance = computed(() => this.totalIncome() - this.totalExpense());

  constructor(private transactionService: TransactionService) {}

  ngOnInit(): void {
    this.transactionService.getTransactions().subscribe({
      next: (res) => {
        this.transactions.set(res.transactions || []);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  formatAmount(n: number): string {
    return n.toLocaleString();
  }
}
