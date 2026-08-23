# Pantry Event Contract (v1)

Private ingredients the user already has at home. This contract is **independent**
of the frozen meal-plan schema (`docs/mealplan-contract.md`) and of grocery lists.
Do not add pantry fields to meal-plan payloads.

## Event envelope

| Field   | Value                                                             |
| ------- | ----------------------------------------------------------------- |
| kind    | `30078` (NIP-78 application-specific data)                        |
| d-tag   | `pantry` (one replaceable list per user)                          |
| tags    | `['d', 'pantry']` and `['client', 'Zap Cooking']` only            |
| content | NIP-44 self-encrypted JSON (encrypted to the author's own pubkey) |

Ingredient names **must not** appear as plaintext Nostr tags.

### Replacement

Saving publishes a new event with the same d-tag. Relays replace per NIP-01
addressable-event rules (newest `created_at` wins).

## Encrypted payload (schemaVersion 1)

```json
{
  "schemaVersion": 1,
  "items": [
    {
      "id": "m5abc-x2k9",
      "name": "Eggs",
      "normalizedName": "egg",
      "quantity": 8,
      "isStaple": true,
      "createdAt": 1789000000,
      "updatedAt": 1789000000
    }
  ],
  "createdAt": 1789000000,
  "updatedAt": 1789000123
}
```

`quantity` and `unit` are optional. Absence means “I have this” without tracking
how much.

`isStaple` is optional. When true, the ingredient is a household staple: it
stays in the pantry until the user removes it, and grocery generation treats it
as already owned (presence-only), even if a quantity is also stored.

Optional item fields may be added in schemaVersion 1 as long as they are ignored
when absent. Unknown fields on items SHOULD be preserved by readers that rewrite
the pantry, so later clients can add expiration dates, barcodes, and similar
without a schema bump.

Readers encountering `schemaVersion > 1` MUST treat the pantry as **read-only**.

## Grocery quantity policy (v1)

- Name match is required.
- A staple (`isStaple: true`) is presence-only → treated as already owned.
- A pantry item **without** a quantity is presence-only → treated as already owned.
- If both sides have a comparable numeric quantity in the **same unit family**,
  compare amounts. Insufficient pantry amount stays on the grocery list.
- Mixed or unparseable units are **uncertain** and stay on the grocery list.
- Pantry inventory is **never** auto-decremented when meals are planned or
  groceries are generated.
