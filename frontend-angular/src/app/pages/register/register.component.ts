import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [FormsModule, RouterLink, TranslateModule],
  templateUrl: './register.component.html',
  styleUrl: './register.component.css'
})
export class RegisterComponent {
  username = '';
  password = '';
  error = signal('');
  success = signal('');

  constructor(private auth: AuthService, private router: Router) {}

  onSubmit(): void {
    this.error.set('');
    this.success.set('');
    this.auth.register(this.username, this.password).subscribe({
      next: () => {
        this.success.set('auth.register_success');
        setTimeout(() => this.router.navigate(['/login']), 1500);
      },
      error: () => {
        this.error.set('auth.register_error');
      }
    });
  }
}
