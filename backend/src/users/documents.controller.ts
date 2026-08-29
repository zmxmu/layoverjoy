import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, JwtAuthGuard, AuthUser } from '../common/auth';
import { UsersService, DocumentInput } from './users.service';
import { AppError } from '../common/errors';

@ApiTags('documents')
@Controller('me/documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const documents = await this.users.listDocuments(user.userId);
    const wallet = await this.users.walletSummary(user.userId);
    return { documents, validVisaCount: wallet.validVisaCount, needsInfoCount: wallet.needsInfoCount };
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: DocumentInput) {
    return this.users.createDocument(user.userId, body);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: Partial<DocumentInput>) {
    if (!id) throw AppError.validation(['id']);
    return this.users.updateDocument(user.userId, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    if (!id) throw AppError.validation(['id']);
    return this.users.deleteDocument(user.userId, id);
  }
}
