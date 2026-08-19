/**
 * 带 TTL 与容量上限的通用缓存。
 * 取代各处手写的「Map + time + size>500 清过期」重复逻辑：
 * get 命中且未过期返回 value，命中已过期或不存在返回 undefined；
 * set 超出容量时触发一次过期清理。
 */
export class TtlCache<V> {
  private _map = new Map<string, { value: V; time: number }>();

  constructor(
    private readonly _ttlMs: number,
    private readonly _maxSize = 500
  ) {}

  /** 读取条目：未命中或已过期返回 undefined（过期的条目同时被清除） */
  get(key: string): V | undefined {
    const entry = this._map.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.time >= this._ttlMs) {
      this._map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /** 是否存在有效条目（未过期）；与 get 的区别：value 为 undefined/null 的负缓存也能区分 */
  has(key: string): boolean {
    const entry = this._map.get(key);
    if (!entry) return false;
    if (Date.now() - entry.time >= this._ttlMs) {
      this._map.delete(key);
      return false;
    }
    return true;
  }

  /** 写入条目并刷新时间戳；超过容量先清过期项，仍超则按 FIFO 淘汰最旧（Map 保插入序） */
  set(key: string, value: V): void {
    this._map.delete(key);
    this._map.set(key, { value, time: Date.now() });
    this.ensureCapacity();
  }

  /** 删除全部过期项 */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this._map) {
      if (now - entry.time >= this._ttlMs) this._map.delete(key);
    }
  }

  /** 保证容量不超上限：先清过期项，仍超则按 FIFO 淘汰最旧（Map 保插入序） */
  private ensureCapacity(): void {
    if (this._map.size <= this._maxSize) return;
    this.cleanup();
    while (this._map.size > this._maxSize) {
      const oldest = this._map.keys().next().value;
      if (oldest === undefined) break;
      this._map.delete(oldest);
    }
  }

  delete(key: string): void {
    this._map.delete(key);
  }

  clear(): void {
    this._map.clear();
  }

  get size(): number {
    return this._map.size;
  }
}
