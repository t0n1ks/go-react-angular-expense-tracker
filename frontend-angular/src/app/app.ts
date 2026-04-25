import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />'
})
export class App {
  constructor(private translate: TranslateService) {
    const stored = localStorage.getItem('angular_lang') || 'en';
    translate.setDefaultLang('en');
    translate.use(stored);
  }
}
