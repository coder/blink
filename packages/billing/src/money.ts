// OSS stub: Billing removed
export class Money {
  constructor(public readonly amount: string) {}

  static fromString(value: string): Money {
    return new Money(value);
  }

  static from(value: string): Money {
    return new Money(value);
  }

  toString(): string {
    return this.amount;
  }

  add(other: Money): Money {
    const a = parseFloat(this.amount);
    const b = parseFloat(other.amount);
    return new Money((a + b).toFixed(10));
  }
}
