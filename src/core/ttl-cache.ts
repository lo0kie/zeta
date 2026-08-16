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

  set(key: string, value: V): void {
    this._map.set(key, { value, time: Date.now() });
    if (this._map.size > this._maxSize) {
      this.cleanup();
      // 仍超容量时按 FIFO 淘汰最旧条目（Map 保插入序），保证硬上限
      while (this._map.size > this._maxSize) {
        const oldest = this._map.keys().next().value;
        if (oldest === undefined) break;
        this._map.delete(oldest);
      }
    }
  }

  /** 删除全部过期项 */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this._map) {
      if (now - entry.time >= this._ttlMs) this._map.delete(key);
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
