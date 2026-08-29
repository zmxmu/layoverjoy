import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController, MeController } from './auth.controller';
import { UsersService } from '../users/users.service';
import { DocumentsController } from '../users/documents.controller';

@Module({
  controllers: [AuthController, MeController, DocumentsController],
  providers: [AuthService, UsersService],
  exports: [AuthService, UsersService],
})
export class AuthModule {}
