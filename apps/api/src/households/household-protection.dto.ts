import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

/**
 * Recording one member's protection answers (M5.9).
 *
 * Every field is optional so a family can answer one question at a time — but note what
 * "optional" means here and what it does not. **Omitting a field leaves the stored answer
 * unchanged; it never resets it to "not asked".** There is deliberately no way to un-answer a
 * question through this DTO: an answer given is a fact, and silently discarding it would put a
 * household back into the state that produced the #67 defect.
 *
 * `false` is a real answer and is stored as one. See `docs/M5_9_PROTECTION_ARCHITECTURE.md` §5.
 */
export class UpdateMemberProtectionDto {
  @ApiProperty({ required: false, description: 'Has term life cover. Omit to leave unchanged.' })
  @IsOptional()
  @IsBoolean()
  hasTermCover?: boolean;

  @ApiProperty({ required: false, description: 'Is covered by health insurance.' })
  @IsOptional()
  @IsBoolean()
  hasHealthInsurance?: boolean;

  /**
   * `Min(0)` rather than `IsPositive`: zero is a meaningful answer here — "I hold a term policy
   * and its sum assured is nil" is nonsense, but "I have no cover" is recorded as
   * `hasTermCover: false` with a zero amount, and the service must be able to store that.
   */
  @ApiProperty({ required: false, description: 'Sum assured, in minor units.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  termLifeCoverMinor?: number;
}
