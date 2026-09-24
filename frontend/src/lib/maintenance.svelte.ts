export interface MaintenanceTask {
  id: string;
  title: string;
  category: 'Home & HVAC' | 'Workshop & 3D Printing' | 'Kitchen & Appliances' | 'Vehicles' | 'General';
  intervalDays: number;
  lastCompletedDate: string; // ISO date
  linkedEntityId?: string;   // Homebox item required (e.g. filter, lubricant, battery)
  linkedEntityName?: string;
  quantityConsumed: number;
  notes?: string;
}

class MaintenanceManager {
  tasks = $state<MaintenanceTask[]>([]);

  constructor() {
    this.load();
  }

  load() {
    try {
      const saved = localStorage.getItem('hwt_maintenance_tasks');
      if (saved) {
        this.tasks = JSON.parse(saved);
      } else {
        // High-value starter household & workshop maintenance tasks
        this.tasks = [
          {
            id: 'hvac-filter',
            title: 'Replace Furnace / AC Filter',
            category: 'Home & HVAC',
            intervalDays: 90,
            lastCompletedDate: new Date(Date.now() - 75 * 86400000).toISOString(),
            linkedEntityName: 'HVAC Air Filter 20x25x1',
            quantityConsumed: 1,
            notes: 'Check airflow arrow direction when inserting new filter.'
          },
          {
            id: 'water-filter',
            title: 'Replace Drinking Water Filter Cartridge',
            category: 'Kitchen & Appliances',
            intervalDays: 60,
            lastCompletedDate: new Date(Date.now() - 40 * 86400000).toISOString(),
            linkedEntityName: 'Water Filter Cartridge',
            quantityConsumed: 1
          },
          {
            id: 'espresso-descale',
            title: 'Descale Espresso Machine & Grouphead Flush',
            category: 'Kitchen & Appliances',
            intervalDays: 45,
            lastCompletedDate: new Date(Date.now() - 50 * 86400000).toISOString(), // overdue!
            linkedEntityName: 'Espresso Descaling Powder',
            quantityConsumed: 1
          },
          {
            id: '3d-printer-lube',
            title: 'Clean & Lubricate 3D Printer Lead Screws',
            category: 'Workshop & 3D Printing',
            intervalDays: 30,
            lastCompletedDate: new Date(Date.now() - 12 * 86400000).toISOString(),
            linkedEntityName: 'PTFE Synthetic Grease',
            quantityConsumed: 1
          },
          {
            id: 'smoke-detectors',
            title: 'Test Smoke & CO Detectors',
            category: 'Home & HVAC',
            intervalDays: 180,
            lastCompletedDate: new Date(Date.now() - 110 * 86400000).toISOString(),
            linkedEntityName: '9V Alkaline Batteries',
            quantityConsumed: 2
          }
        ];
        this.save();
      }
    } catch (e) {
      console.warn('Failed to load maintenance tasks', e);
    }
  }

  save() {
    try {
      localStorage.setItem('hwt_maintenance_tasks', JSON.stringify(this.tasks));
    } catch (e) {
      console.warn('Failed to save maintenance tasks', e);
    }
  }

  addTask(task: Omit<MaintenanceTask, 'id'>) {
    const newTask: MaintenanceTask = {
      ...task,
      id: Math.random().toString(36).substring(2, 9),
    };
    this.tasks.push(newTask);
    this.save();
    return newTask;
  }

  removeTask(id: string) {
    this.tasks = this.tasks.filter((t) => t.id !== id);
    this.save();
  }

  completeTask(id: string) {
    const task = this.tasks.find((t) => t.id === id);
    if (task) {
      task.lastCompletedDate = new Date().toISOString();
      this.save();
    }
  }

  getDaysRemaining(task: MaintenanceTask): number {
    const last = new Date(task.lastCompletedDate).getTime();
    const nextDue = last + task.intervalDays * 86400000;
    const diffDays = Math.round((nextDue - Date.now()) / 86400000);
    return diffDays;
  }
}

export const maintenanceManager = new MaintenanceManager();
