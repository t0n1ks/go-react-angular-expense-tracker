import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-language-switcher',
  standalone: true,
  imports: [FormsModule],
  template: `
    <select
      class="language-switcher"
      [ngModel]="currentLang"
      (ngModelChange)="changeLang($event)"
      aria-label="Select language"
    >
      <option value="en">EN</option>
      <option value="de">DE</option>
      <option value="ru">RU</option>
      <option value="uk">UK</option>
    </select>
  `
})
export class LanguageSwitcherComponent {
  currentLang: string;

  constructor(private translate: TranslateService) {
    this.currentLang = translate.currentLang || translate.defaultLang || 'en';
  }

  changeLang(lang: string): void {
    this.currentLang = lang;
    this.translate.use(lang);
    localStorage.setItem('angular_lang', lang);
  }
}
