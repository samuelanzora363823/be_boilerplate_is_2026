import { IsBoolean } from 'class-validator';

export class UpdateLoyaltyBenefitStatusDto {
  @IsBoolean()
  isActive!: boolean;
}
