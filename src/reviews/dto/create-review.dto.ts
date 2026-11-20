import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'exactlyOneReviewPurchase', async: false })
class ExactlyOneReviewPurchaseConstraint
  implements ValidatorConstraintInterface
{
  validate(_value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as CreateReviewDto;
    return Boolean(dto.accountId) !== Boolean(dto.orderId);
  }

  defaultMessage(): string {
    return 'Debes proporcionar exactamente uno de accountId u orderId.';
  }
}

export class CreateReviewDto {
  @ValidateIf((_dto, value) => value !== undefined && value !== null)
  @IsUUID()
  accountId?: string;

  @ValidateIf((_dto, value) => value !== undefined && value !== null)
  @IsUUID()
  orderId?: string;

  @IsInt()
  @Min(1)
  @Max(5)
  @Validate(ExactlyOneReviewPurchaseConstraint)
  rating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
