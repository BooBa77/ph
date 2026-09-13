import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  async check() {
    const started = Date.now();
    await this.dataSource.query('SELECT 1');
    return {
      status: 'ok',
      db: 'ok',
      latencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    };
  }
}