# Register Map Analysis: energy-report

> v0.1 · 2026-10-09 · How the vendor's `register-map.md` applies to `input/telemetry.jsonl`, with
> evidence. `register-map.md` is copied verbatim from the take-home package
> (`energy-report-take-home.zip`) and is **never edited**; all interpretation lives here.
> Figures come from a read-only exploratory decode run on 2026-10-09. The implementation's tests must
> reproduce them (`testing-standards.md` §5).

## 1. Address mapping

Map note: PDU address = table address − 40001. Telemetry `start_addr` is a PDU address.

| Table address | PDU | Name | Type | Index in `regs` for M1/M2 (`start_addr` 100) | Index in `regs` for M3 (`start_addr` 99) |
|---|---|---|---|---|---|
| 40100 | 99 | Model ID | uint16 | not read | 0 |
| 40101–40102 | 100–101 | Active power | float32 | 0–1 | 1–2 |
| 40103–40104 | 102–103 | Active energy import counter | uint32 | 2–3 | 3–4 |
| 40105 | 104 | Energy scale factor (SF) | int16 | 4 | 5 |
| 40106–40107 | 105–106 | Uptime | uint32 (s) | 5–6 | 6–7 |

Look values up by address (`regs[addr − start_addr]`), never by fixed index. Every record must
cover PDU 100–106.

## 2. Decoding

- **uint32:** `high × 65536 + low`. The low word is at the lower address (map: "low word first").
- **float32:** `bits = high << 16 | low`, read as IEEE 754 with big-endian bytes inside each
  register. `bits === 0x7FC00000` means "not available": the value is not a reading.
- **int16:** `v ≥ 32768 ? v − 65536 : v`.
- **Energy (Wh):** `counter × 10^SF`. Interval energy is `(counter_end − counter_start) × 10^SF`,
  converted to kWh.

## 3. Verified against the data

| Fact | Evidence |
|---|---|
| The addressing is right | Every M3 read has PDU 99 = `8010` = `0x1F4A`, the PM-3 Model ID |
| SF is constant per meter (note 3) | M1 = 0 (Wh), M2 = 1 (×10 Wh), M3 = −1 (×0.1 Wh) on every read |
| Counter, word order and SF are right | Σ energy for 2026-10-24 (M1+M2+M3) = **1,705.566 kWh**, inside the billing range 1,703.894–1,707.306 (1,705.6 ± 0.1 %) |
| "Not available" power occurs | 3 reads, all M1: 2026-10-24T09:10:00+02:00, 2026-10-26T13:30:00+01:00, 2026-10-26T13:35:00+01:00 |
| Counter rollover occurs (note 1) | M2 2026-10-25T04:40:01+01:00 → 04:45:01+01:00: 4,294,967,264 → 47. Modular Δ = 79 counts = 790 Wh |
| Power loss occurs (notes 2, 4) | M3 2026-10-26T10:40:02+01:00 → 11:25:02+01:00 (inside the gap): uptime 466,179 s → 202 s, counter 15,794,389 → 15,684,399 (−10,999 Wh, back to the last hourly save) |
| No other invalid power | No negative, infinite or other-NaN power values |

## 4. Conflicts and decisions

| # | Conflict | Evidence | Decision | Status |
|---|---|---|---|---|
| C-01 | One M2 `fw_msg` says the SF register misreports and SF = 2 should be used | Register SF = 1 matches the bill (1,705.566 kWh). SF = 2 gives 6,576.366 kWh, 3.9× the bill. Map note 3 says SF is set at the factory and doesn't change. | Use the register SF. Ignore `fw_msg` (BR-13). | Decided |
| C-02 | Note 5: power is L1 per phase, so multiply by 3 for the total. TASK wants the three-phase total. | The raw power register ÷ the counter-implied average power has median **1.000** on every meter (p10–p90: M1 0.98–1.02, M2 0.97–1.04, M3 0.91–1.11). The counter is confirmed by the bill, so the raw register already ≈ the total, and ×3 would overstate peaks 3×. Example: M1 2026-10-25T02:35:00+01:00 raw 71,250.5 W, and the counter average over the next 5 min is 71.3 kW. | (a) Use the raw register as the three-phase total, with no ×3. Record the note-5 conflict in NOTES.md. (Option (b), ×3 per note 5, was rejected.) | Decided (a), user 2026-10-09 |
| C-03 | Table addresses are Modicon (4xxxx, 1-based); telemetry `start_addr` is PDU | M1/M2 start 100 = 40101 (power). M3 starts 99 = 40100 (Model ID). | Map by PDU address (§1) | Decided |
| C-04 | Counter rollover vs "never invent energy" | Note 1 defines the wrap at 2^32. A single wrap within one interval is unambiguous. | Count the modular Δ when there is no restart and Δ < 2^31. Report `counter_rollover`. | Decided |
| C-05 | After a power loss the counter resumes from the last hourly save | The uptime reset identifies the restart | An interval containing a restart (`uptime_end < interval seconds`) counts 0 and is reported with reason `power_loss` | Decided |

## 5. Decode constants (for `src/config/constants.ts`)

| Name | Value |
|---|---|
| `REG_MODEL_ID` | 99 |
| `REG_ACTIVE_POWER` | 100 (low), 101 (high) |
| `REG_ENERGY_COUNTER` | 102 (low), 103 (high) |
| `REG_SCALE_FACTOR` | 104 |
| `REG_UPTIME` | 105 (low), 106 (high) |
| `REQUIRED_ADDR_FIRST`, `REQUIRED_ADDR_LAST` | 100, 106 |
| `PM3_MODEL_ID` | `0x1F4A` |
| `FLOAT32_NOT_AVAILABLE` | `0x7FC00000` |
| `COUNTER_MODULUS` | 2^32 |

## 6. Expected report values (exploratory decode)

| date | meter | energy_kwh | intervals | peak raw W (C-02 a) | peak ×3 W (C-02 b) | peak_at |
|---|---|---|---|---|---|---|
| 2026-10-24 | M1 | 913.45 | 283 | 48,085.5 | 144,256.5 | 2026-10-24T14:25:00+02:00 |
| 2026-10-24 | M2 | 541.20 | 288 | 31,963.3 | 95,889.9 | 2026-10-24T13:15:01+02:00 |
| 2026-10-24 | M3 | 250.92 | 288 | 19,359.6 | 58,078.8 | 2026-10-24T10:20:02+02:00 |
| 2026-10-25 | M1 | 945.35 | 300 | 71,250.5 | 213,751.5 | 2026-10-25T02:35:00**+01:00** |
| 2026-10-25 | M2 | 552.29 | 300 | 31,838.8 | 95,516.4 | 2026-10-25T13:15:01+01:00 |
| 2026-10-25 | M3 | 253.93 | 300 | 19,157.7 | 57,473.1 | 2026-10-25T15:55:02+01:00 |
| 2026-10-26 | M1 | 910.66 | 288 | 47,138.9 | 141,416.7 | 2026-10-26T15:05:00+01:00 |
| 2026-10-26 | M2 | 539.11 | 288 | 31,747.7 | 95,243.1 | 2026-10-26T18:05:01+01:00 |
| 2026-10-26 | M3 | 238.01 | 280 | 19,262.6 | 57,787.8 | 2026-10-26T18:05:02+01:00 |

The M1 peak on 2026-10-25 falls in the repeated DST hour, in the second (+01:00) pass. The first
pass at 02:35+02:00 reads a lower 64,012.5 W raw.

- **Events:**
  - `gap` M1 2026-10-24T15:00:00+02:00 → 15:30:00+02:00, `energy_counted: true`;
  - `counter_rollover` M2 2026-10-25T04:40:01+01:00 → 04:45:01+01:00;
  - `gap` M3 2026-10-26T10:40:02+01:00 → 11:25:02+01:00, `energy_counted: false`,
    `reason: power_loss`.
- **Counters:** `duplicates_dropped` 37, `invalid_power_readings` 3.
