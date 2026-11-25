import {
  IsOptional,
  IsUUID,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
  type ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ name: 'exactlyOnePurchaseTarget', async: false })
class ExactlyOnePurchaseTargetConstraint
  implements ValidatorConstraintInterface
{
  validate(_value: unknown, args: ValidationArguments): boolean {
    const request = args.object as CreateRedemptionDto;
    return Boolean(request.accountId) !== Boolean(request.orderId);
  }

  defaultMessage(): string {
    return 'Debes proporcionar exactamente uno de accountId u orderId.';
  }
}

export class CreateRedemptionDto {
  @IsUUID()
  @Validate(ExactlyOnePurchaseTargetConstraint)
  benefitId!: string;

  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsUUID()
  orderId?: string;
}
