import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { UserRole, type User } from '@PrismaClient';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CreateReviewDto } from './dto/create-review.dto.js';
import { ReviewsService } from './reviews.service.js';

@Controller('reviews')
@Roles(UserRole.CLIENTE)
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: User, @Body() body: CreateReviewDto) {
    return this.reviewsService.create(user, body);
  }
}
