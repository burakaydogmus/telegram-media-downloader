export type Factory<TServices extends Record<string, unknown>, T> = (
  container: Container<TServices>,
) => T;

interface Registration<TServices extends Record<string, unknown>, T> {
  readonly factory: Factory<TServices, T>;
  readonly singleton: boolean;
  instance?: T;
  hasInstance: boolean;
}

export class Container<TServices extends Record<string, unknown>> {
  private readonly registrations = new Map<
    keyof TServices,
    Registration<TServices, TServices[keyof TServices]>
  >();

  registerSingleton<K extends keyof TServices>(
    token: K,
    factory: Factory<TServices, TServices[K]>,
  ): this {
    this.registrations.set(token, {
      factory: factory as Factory<TServices, TServices[keyof TServices]>,
      singleton: true,
      hasInstance: false,
    });
    return this;
  }

  registerTransient<K extends keyof TServices>(
    token: K,
    factory: Factory<TServices, TServices[K]>,
  ): this {
    this.registrations.set(token, {
      factory: factory as Factory<TServices, TServices[keyof TServices]>,
      singleton: false,
      hasInstance: false,
    });
    return this;
  }

  registerValue<K extends keyof TServices>(token: K, value: TServices[K]): this {
    this.registrations.set(token, {
      factory: () => value,
      singleton: true,
      hasInstance: true,
      instance: value,
    });
    return this;
  }

  resolve<K extends keyof TServices>(token: K): TServices[K] {
    const registration = this.registrations.get(token);
    if (!registration) {
      throw new Error(`No registration for service token: ${String(token)}`);
    }
    if (registration.singleton) {
      if (!registration.hasInstance) {
        registration.instance = registration.factory(this);
        registration.hasInstance = true;
      }
      return registration.instance as TServices[K];
    }
    return registration.factory(this) as TServices[K];
  }

  has<K extends keyof TServices>(token: K): boolean {
    return this.registrations.has(token);
  }
}
