import { Controller, Get } from '@nestjs/common';
import { Public } from './shared/decorators/public.decorator';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Public()
  @Get('/auth/api-info')
  apiInfo() {
    return {
      name: 'vales-yacatec-api',
      version: '0.1.0',
      modules: ['auth', 'sessions', 'password-reset', 'mfa'],
    };
  }
}
