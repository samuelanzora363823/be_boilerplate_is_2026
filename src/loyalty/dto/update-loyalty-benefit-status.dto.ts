import { IsBoolean } from 'class-validator';

// H22: activa o desactiva un beneficio. Usa `active`, el mismo nombre que el
// modelo LoyaltyBenefit y la consulta de beneficios activos de H21.
export class UpdateLoyaltyBenefitStatusDto {
  @IsBoolean({ message: 'El estado debe ser verdadero o falso.' })
  active!: boolean;
}
