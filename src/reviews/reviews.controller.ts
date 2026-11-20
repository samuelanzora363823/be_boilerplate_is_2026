import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole, type User } from '@PrismaClient';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CreateReviewDto } from './dto/create-review.dto.js';
import { ListBranchReviewsDto } from './dto/list-branch-reviews.dto.js';
import { ReviewsService } from './reviews.service.js';

@Controller()
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post('reviews')
  @Roles(UserRole.CLIENTE)
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: User, @Body() body: CreateReviewDto) {
    return this.reviewsService.create(user, body);
  }

  @Get('branches/:branchId/reviews')
  @Roles(UserRole.GERENTE)
  listBranchReviews(
    @CurrentUser() user: User,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: ListBranchReviewsDto,
  ) {
    return this.reviewsService.listBranchReviews(user, branchId, query);
  }
}
