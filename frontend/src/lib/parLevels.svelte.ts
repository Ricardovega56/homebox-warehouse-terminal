export interface ParLevelPolicy {
  entityId: string;
  minQty: number;
  targetQty: number;
  unit?: string;
  supplierUrl?: string;
}

export interface ShoppingItem {
  id: string;
  entityId?: string;
  name: string;
  qtyNeeded: number;
  unit: string;
  completed: boolean;
  source: 'par_level' | 'manual' | 'meal';
}

class ParLevelManager {
  policies = $state<Record<string, ParLevelPolicy>>({});
  manualShoppingItems = $state<ShoppingItem[]>([]);

  constructor() {
    this.load();
  }

  load() {
    try {
      const savedPolicies = localStorage.getItem('hwt_par_policies');
      if (savedPolicies) {
        this.policies = JSON.parse(savedPolicies);
      }
      const savedItems = localStorage.getItem('hwt_shopping_items');
      if (savedItems) {
        this.manualShoppingItems = JSON.parse(savedItems);
      }
    } catch (e) {
      console.warn('Failed to load par levels/shopping items from storage', e);
    }
  }

  save() {
    try {
      localStorage.setItem('hwt_par_policies', JSON.stringify(this.policies));
      localStorage.setItem('hwt_shopping_items', JSON.stringify(this.manualShoppingItems));
    } catch (e) {
      console.warn('Failed to save par levels/shopping items to storage', e);
    }
  }

  setPolicy(entityId: string, minQty: number, targetQty: number, unit = 'pcs') {
    this.policies[entityId] = {
      entityId,
      minQty,
      targetQty,
      unit
    };
    this.save();
  }

  removePolicy(entityId: string) {
    delete this.policies[entityId];
    this.save();
  }

  addManualItem(name: string, qtyNeeded = 1, unit = 'pcs') {
    this.manualShoppingItems.push({
      id: Math.random().toString(36).substring(2, 9),
      name,
      qtyNeeded,
      unit,
      completed: false,
      source: 'manual'
    });
    this.save();
  }

  toggleItemCompleted(id: string) {
    const item = this.manualShoppingItems.find(i => i.id === id);
    if (item) {
      item.completed = !item.completed;
      this.save();
    }
  }

  removeShoppingItem(id: string) {
    this.manualShoppingItems = this.manualShoppingItems.filter(i => i.id !== id);
    this.save();
  }

  clearCompleted() {
    this.manualShoppingItems = this.manualShoppingItems.filter(i => !i.completed);
    this.save();
  }
}

export const parLevelManager = new ParLevelManager();
