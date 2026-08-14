import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { HouseholdMember } from '@prisma/client';
import type { IntelligenceAssumptions } from '@lcos/core';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/decorators';
import { FirmContext } from '../firms/firm-context.decorators';
import { UpdateMemberProtectionDto } from './household-protection.dto';

/**
 * Household protection (M5.9) — the data path the V2 intelligence layer was missing.
 *
 * Design: `docs/M5_9_PROTECTION_ARCHITECTURE.md`.
 *
 * ## What was actually broken
 *
 * Not a missing form. `HouseholdIntelligenceService.current()` takes an `assumptions` argument
 * and **no caller passed it**, so `assumptions.insurance` was permanently `undefined`. The V2
 * Protection panel had a calculator, a route and a panel, and nothing connecting them.
 *
 * ## Why protection lives on `HouseholdMember`
 *
 * Protection is a fact about a *person*, and `HouseholdMember` is already the household's
 * person-level table — the one the snapshot reads for ages and dependency. The retail `Profile`
 * was rejected: one row per user, so it cannot hold a spouse's separate term policy, and an
 * advisor viewing a client household would have their **own** protection read as the client's.
 * That is the confusion behind #52 and #54.
 *
 * ## The seam
 *
 * `assumptionsFor()` is the whole of the future Insurance Intelligence™ module's attachment
 * point. Today it aggregates three member columns. When real policies arrive — insurer, premium,
 * renewal, riders — that method changes its source and nothing else moves: the layer contract,
 * the controller wiring, the dashboard and the AI grounding are already correct and already fed.
 */
@Injectable()
export class HouseholdProtectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  private serialize(m: HouseholdMember) {
    return {
      memberId: m.id,
      name: this.crypto.decrypt(m.name),
      relation: m.relation,
      isDependent: m.isDependent,
      /** `null` is "not asked" and travels to the client as `null`, never coerced to false. */
      hasTermCover: m.hasTermCover,
      hasHealthInsurance: m.hasHealthInsurance,
      termLifeCoverMinor:
        m.termLifeCoverMinor === null ? null : Number(m.termLifeCoverMinor),
      /** What this person still has to answer, so the surface can be specific rather than nag. */
      unanswered: this.unansweredFor(m),
    };
  }

  /**
   * Which questions this member still owes an answer to.
   *
   * Term cover is only asked of non-dependants: a child's own term policy is not what protects
   * the household's income, and asking would add friction for an answer nothing consumes.
   * Health cover is asked of everyone, because medical exposure is per person — one uninsured
   * child is a real gap that a household-level question would hide.
   */
  private unansweredFor(m: HouseholdMember): string[] {
    const missing: string[] = [];
    if (!m.isDependent && m.hasTermCover === null) missing.push('hasTermCover');
    if (m.hasHealthInsurance === null) missing.push('hasHealthInsurance');
    return missing;
  }

  private async owned(householdId: string, memberId: string) {
    const member = await this.prisma.householdMember.findUnique({ where: { id: memberId } });
    if (!member || member.householdId !== householdId) {
      throw new NotFoundException('Member not found');
    }
    return member;
  }

  /**
   * The actor must be a member of this household **as themselves** before recording protection
   * for it. Same boundary as household goals (M5.8 PR 2): an advisor recording a client's cover
   * would be entering an answer they cannot have given, and `HouseholdMember.userId` is the
   * signal that means *this is my family, not my client's*.
   */
  private async assertOwnHousehold(actor: AuthUser, householdId: string) {
    const self = await this.prisma.householdMember.findFirst({
      where: { householdId, userId: actor.id },
    });
    if (!self) {
      throw new ForbiddenException(
        'Protection can only be recorded by a member of this household. ' +
          'Advisor-recorded cover is not supported yet.',
      );
    }
  }

  /** Per-member answers plus the household roll-up the family sees. */
  async overview(householdId: string) {
    const members = await this.prisma.householdMember.findMany({
      where: { householdId },
      orderBy: { id: 'asc' },
    });
    const rows = members.map((m) => this.serialize(m));
    const summary = this.aggregate(members);
    return {
      members: rows,
      /**
       * `null` while the household has not finished answering — the same "not asked" state the
       * columns carry, surfaced so the client never has to infer it from an amount of zero.
       */
      summary: summary ?? null,
      coverTracked: summary !== undefined,
      unansweredMemberIds: rows.filter((r) => r.unanswered.length > 0).map((r) => r.memberId),
    };
  }

  async update(
    actor: AuthUser,
    firm: FirmContext,
    householdId: string,
    memberId: string,
    dto: UpdateMemberProtectionDto,
    ip?: string,
  ) {
    await this.assertOwnHousehold(actor, householdId);
    await this.owned(householdId, memberId);

    const member = await this.prisma.householdMember.update({
      where: { id: memberId },
      data: {
        // Each field is written only when present. An omitted field keeps its stored answer;
        // it is never reset to null, so an answer once given cannot be silently lost.
        ...(dto.hasTermCover !== undefined ? { hasTermCover: dto.hasTermCover } : {}),
        ...(dto.hasHealthInsurance !== undefined
          ? { hasHealthInsurance: dto.hasHealthInsurance }
          : {}),
        ...(dto.termLifeCoverMinor !== undefined
          ? { termLifeCoverMinor: BigInt(dto.termLifeCoverMinor) }
          : {}),
      },
    });

    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'household.protection.update',
      entityType: 'HouseholdMember',
      entityId: memberId,
      // Field names only. The answers themselves are a family's insurance position and do not
      // belong in an audit trail read by firm staff.
      metadata: { firmId: firm.firmId, householdId, fields: Object.keys(dto) },
      ip,
    });
    return this.serialize(member);
  }

  /**
   * The household's protection, in the shape the Financial Intelligence Layer declares.
   *
   * Returns `undefined` — not a zero-filled object — when the household has not finished
   * answering. That is the entire missing-versus-inadequate distinction at this boundary: the
   * layer treats an absent `insurance` assumption as "not asked" and stays silent, while a
   * `{ existingCoverMinor: 0, hasTermCover: false }` would state that the family has no cover.
   *
   * **This method performs no protection arithmetic.** Recommended cover, the shortfall and the
   * red/amber thresholds all stay in `@lcos/core`. Summing stated amounts and counting stated
   * answers is selection, not calculation.
   */
  async assumptionsFor(householdId: string): Promise<IntelligenceAssumptions['insurance']> {
    const members = await this.prisma.householdMember.findMany({ where: { householdId } });
    return this.aggregate(members);
  }

  /**
   * Members → the layer's three values, or `undefined` while anyone is unanswered.
   *
   * A household with a spouse who has not answered is not a household we can assess, and
   * reporting a gap computed from half the family is the fabrication this milestone removes.
   */
  private aggregate(members: HouseholdMember[]): IntelligenceAssumptions['insurance'] {
    if (members.length === 0) return undefined;
    if (members.some((m) => this.unansweredFor(m).length > 0)) return undefined;

    const adults = members.filter((m) => !m.isDependent);

    // Life cover replaces the HOUSEHOLD's income, and the recommendation it is compared against
    // is a household figure — so the comparison is the household's total cover.
    const existingCoverMinor = adults
      .filter((m) => m.hasTermCover)
      .reduce((sum, m) => sum + Number(m.termLifeCoverMinor ?? 0), 0);

    return {
      existingCoverMinor,
      hasTermCover: adults.some((m) => m.hasTermCover === true),
      // EVERY member, dependants included. Health exposure is per person, so "any" would let a
      // household with one uninsured child read as covered.
      hasHealthInsurance: members.every((m) => m.hasHealthInsurance === true),
    };
  }
}
