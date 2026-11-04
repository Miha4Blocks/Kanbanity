import { useEffect, useMemo, useState, type DragEvent, type FormEvent } from "react";
import {
  Activity,
  AlertCircle,
  AlignLeft,
  ArrowDown,
  ArrowDownWideNarrow,
  ArrowUp,
  Bell,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Command,
  Filter,
  Flag,
  FolderKanban,
  LayoutDashboard,
  ListTodo,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";

type Priority = "Срочно" | "Высокий" | "Средний" | "Низкий";
type Comment = { id: string; author: string; text: string; createdAt: string };
type Task = {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  assignee: string;
  dueDate: string;
  labels: string[];
  comments: Comment[];
};
type Column = { id: string; title: string; accent: string; limit?: number };
type ActivityItem = { id: string; message: string; time: string };
type Project = { id: string; name: string; icon: string; color: string; description: string; schedule: string; prefix: string };
type ProjectBoard = { columns: Column[]; tasksByColumn: Record<string, Task[]> };
type WorkspaceSettings = { name: string; description: string };
type PersistedAppState = {
  boardsByProject: Record<string, ProjectBoard>;
  workspaceSettings: WorkspaceSettings;
  activity: ActivityItem[];
  readNotificationIds: string[];
};
type DatabaseStatus = "connecting" | "saved" | "saving" | "error";
type SortField = "default" | "taskNumber" | "priority" | "dueDate" | "title";

const initialColumns: Column[] = [
  { id: "backlog", title: "К выполнению", accent: "#8b91a1" },
  { id: "progress", title: "В работе", accent: "#7b72e9", limit: 4 },
  { id: "review", title: "На проверке", accent: "#e5a545", limit: 3 },
  { id: "done", title: "Готово", accent: "#44a887" },
];

const initialTasks: Record<string, Task[]> = {
  backlog: [
    {
      id: "KAN-24",
      title: "Подготовить карту пользовательского пути",
      description: "Собрать ключевые сценарии для первого запуска и согласовать их с командой.",
      priority: "Средний",
      assignee: "Александра",
      dueDate: "2026-11-08",
      labels: ["Исследование", "UX"],
      comments: [],
    },
    {
      id: "KAN-25",
      title: "Обновить тексты onboarding",
      description: "Сократить шаги приветствия и обновить подсказки для новых пользователей.",
      priority: "Низкий",
      assignee: "Михаил",
      dueDate: "",
      labels: ["Контент"],
      comments: [{ id: "c1", author: "Михаил", text: "Черновик уже готов, отправлю сегодня.", createdAt: "10:42" }],
    },
    {
      id: "KAN-26",
      title: "Согласовать структуру раздела помощи",
      description: "",
      priority: "Высокий",
      assignee: "Екатерина",
      dueDate: "2026-11-12",
      labels: ["Документация"],
      comments: [],
    },
  ],
  progress: [
    {
      id: "KAN-18",
      title: "Создать компоненты карточек задач",
      description: "Состояния карточек, метки, аватары и варианты приоритета.",
      priority: "Высокий",
      assignee: "Михаил",
      dueDate: "2026-11-06",
      labels: ["Разработка", "UI"],
      comments: [{ id: "c2", author: "Александра", text: "Отличный прогресс! Посмотрю после обеда.", createdAt: "11:18" }],
    },
    {
      id: "KAN-21",
      title: "Интеграция поиска по задачам",
      description: "Добавить быстрый поиск по названию, описанию и номеру задачи.",
      priority: "Срочно",
      assignee: "Александра",
      dueDate: "2026-11-05",
      labels: ["Разработка"],
      comments: [],
    },
    {
      id: "KAN-22",
      title: "Собрать экран настроек проекта",
      description: "",
      priority: "Средний",
      assignee: "Дмитрий",
      dueDate: "",
      labels: ["UI"],
      comments: [],
    },
  ],
  review: [
    {
      id: "KAN-15",
      title: "Адаптивная навигация для мобильных",
      description: "Проверить меню на ширине от 360 px и настроить переходы.",
      priority: "Высокий",
      assignee: "Екатерина",
      dueDate: "2026-11-05",
      labels: ["Разработка", "Mobile"],
      comments: [],
    },
    {
      id: "KAN-16",
      title: "Экран пустого состояния доски",
      description: "",
      priority: "Низкий",
      assignee: "Дмитрий",
      dueDate: "",
      labels: ["UI"],
      comments: [],
    },
  ],
  done: [
    {
      id: "KAN-11",
      title: "Определить визуальное направление",
      description: "Палитра, типографика, сетка и базовые компоненты.",
      priority: "Средний",
      assignee: "Александра",
      dueDate: "2026-11-01",
      labels: ["Дизайн"],
      comments: [],
    },
    {
      id: "KAN-12",
      title: "Настроить рабочее пространство",
      description: "",
      priority: "Низкий",
      assignee: "Дмитрий",
      dueDate: "2026-11-02",
      labels: ["Команда"],
      comments: [],
    },
  ],
};

const people = [
  { name: "Александра", initials: "АС", color: "lavender" },
  { name: "Михаил", initials: "МР", color: "peach" },
  { name: "Екатерина", initials: "ЕК", color: "mint" },
  { name: "Дмитрий", initials: "ДВ", color: "blue" },
];

const initialActivity: ActivityItem[] = [
  { id: "a1", message: "Михаил переместил задачу KAN-18 в «В работе»", time: "12 минут назад" },
  { id: "a2", message: "Вы завершили задачу KAN-12", time: "1 час назад" },
  { id: "a3", message: "Александра добавила комментарий к KAN-18", time: "2 часа назад" },
];

const projects: Project[] = [
  { id: "redesign", name: "Редизайн платформы", icon: "✳", color: "purple", description: "Создаём новый опыт для наших пользователей", schedule: "21 окт — 18 ноя, 2026", prefix: "KAN" },
  { id: "mobile", name: "Мобильное приложение", icon: "◈", color: "orange", description: "Запускаем удобное мобильное приложение", schedule: "3 ноя — 15 дек, 2026", prefix: "MOB" },
  { id: "content", name: "Контент-маркетинг", icon: "◌", color: "blue", description: "Планируем и создаём полезный контент", schedule: "1 ноя — 30 ноя, 2026", prefix: "CNT" },
];

const workspaceSettingsKey = "kanbanity.workspace-settings.v1";
const projectBoardsKey = "kanbanity.project-boards.v1";

function createProjectTasks(prefix: string, titles: string[]): Record<string, Task[]> {
  let taskNumber = 1;
  return Object.fromEntries(
    Object.entries(initialTasks).map(([columnId, tasks]) => [
      columnId,
      tasks.map((task, index) => {
        const number = taskNumber++;
        return {
          ...task,
          id: `${prefix}-${number}`,
          title: titles[number - 1] ?? task.title,
          description: "",
          labels: task.labels.slice(0, 1),
          comments: [],
          assignee: people[(index + number) % people.length].name,
        };
      }),
    ]),
  );
}

function createInitialBoards(): Record<string, ProjectBoard> {
  return {
    redesign: {
      columns: readStorage(storageKeys.columns, initialColumns),
      tasksByColumn: readStorage(storageKeys.tasks, initialTasks),
    },
    mobile: {
      columns: initialColumns,
      tasksByColumn: createProjectTasks("MOB", [
        "Составить карту экранов приложения",
        "Подготовить прототип регистрации",
        "Согласовать мобильную дизайн-систему",
        "Реализовать навигацию приложения",
        "Подключить push-уведомления",
        "Проверить авторизацию на iOS и Android",
        "Провести тестирование на устройствах",
        "Настроить сборку приложения",
        "Опубликовать бета-версию",
        "Подготовить план первого релиза",
      ]),
    },
    content: {
      columns: initialColumns,
      tasksByColumn: createProjectTasks("CNT", [
        "Собрать темы для редакционного плана",
        "Подготовить бриф для авторов",
        "Обновить контент-календарь",
        "Написать статью о продукте",
        "Согласовать публикацию с командой",
        "Подготовить рассылку для подписчиков",
        "Проверить публикации перед запуском",
        "Настроить аналитику контента",
        "Опубликовать материалы месяца",
        "Подвести итоги кампании",
      ]),
    },
  };
}

const priorityMeta: Record<Priority, { className: string; icon: typeof Flag }> = {
  Срочно: { className: "urgent", icon: AlertCircle },
  Высокий: { className: "high", icon: ArrowUp },
  Средний: { className: "medium", icon: ArrowUp },
  Низкий: { className: "low", icon: ArrowDown },
};

const storageKeys = {
  columns: "kanbanity.columns.v1",
  tasks: "kanbanity.tasks.v1",
  activity: "kanbanity.activity.v1",
  readNotifications: "kanbanity.read-notifications.v1",
};

function readStorage<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch (error) {
    console.error(`Не удалось загрузить сохранённые данные Kanbanity (${key})`, error);
    return fallback;
  }
}

function getPerson(name: string) {
  return people.find((person) => person.name === name) ?? { name, initials: name.slice(0, 2).toUpperCase() || "—", color: "blue" };
}

function formatDueDate(value: string) {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(date).replace(".", "");
}

function App() {
  const [activeProjectId, setActiveProjectId] = useState("redesign");
  const [boardsByProject, setBoardsByProject] = useState<Record<string, ProjectBoard>>(() =>
    readStorage(projectBoardsKey, createInitialBoards()),
  );
  const [workspaceSettings, setWorkspaceSettings] = useState<WorkspaceSettings>(() =>
    readStorage(workspaceSettingsKey, { name: "Studio North", description: "Рабочее пространство" }),
  );
  const [activity, setActivity] = useState<ActivityItem[]>(() => readStorage(storageKeys.activity, initialActivity));
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>(() =>
    readStorage(storageKeys.readNotifications, []),
  );
  const [databaseReady, setDatabaseReady] = useState(false);
  const [databaseStatus, setDatabaseStatus] = useState<DatabaseStatus>("connecting");
  const [databaseError, setDatabaseError] = useState("");
  const [databaseRetry, setDatabaseRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("Все приоритеты");
  const [assigneeFilter, setAssigneeFilter] = useState("Все исполнители");
  const [labelFilter, setLabelFilter] = useState("Все метки");
  const [activeNav, setActiveNav] = useState("Доска проекта");
  const [activeView, setActiveView] = useState("Доска");
  const [showWorkspaceSettings, setShowWorkspaceSettings] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [sortField, setSortField] = useState<SortField>("default");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [modalTask, setModalTask] = useState<Task | null>(null);
  const [modalColumnId, setModalColumnId] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setDatabaseReady(false);
    setDatabaseStatus("connecting");
    setDatabaseError("");

    async function initializeDatabase() {
      try {
        const response = await fetch("/api/state");
        if (!response.ok) throw new Error(`Не удалось подключиться к базе данных (HTTP ${response.status})`);
        const result = (await response.json()) as { state: PersistedAppState | null };
        let state = result.state;

        if (!state) {
          state = {
            boardsByProject: readStorage(projectBoardsKey, createInitialBoards()),
            workspaceSettings: readStorage(workspaceSettingsKey, { name: "Studio North", description: "Рабочее пространство" }),
            activity: readStorage(storageKeys.activity, initialActivity),
            readNotificationIds: readStorage(storageKeys.readNotifications, []),
          };
          const seedResponse = await fetch("/api/state", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state }),
          });
          if (!seedResponse.ok) throw new Error(`Не удалось перенести данные в базу (HTTP ${seedResponse.status})`);
        }

        if (!active) return;
        setBoardsByProject(state.boardsByProject);
        setWorkspaceSettings(state.workspaceSettings);
        setActivity(state.activity);
        setReadNotificationIds(state.readNotificationIds);
        setDatabaseReady(true);
        setDatabaseStatus("saved");
      } catch (error) {
        console.error("Не удалось загрузить данные Kanbanity из SQLite:", error);
        if (!active) return;
        setDatabaseError(error instanceof Error ? error.message : "Не удалось подключиться к базе данных");
        setDatabaseStatus("error");
      }
    }

    void initializeDatabase();
    return () => {
      active = false;
    };
  }, [databaseRetry]);

  useEffect(() => {
    if (!databaseReady) return;
    let active = true;
    const state: PersistedAppState = { boardsByProject, workspaceSettings, activity, readNotificationIds };
    const timer = window.setTimeout(async () => {
      setDatabaseStatus("saving");
      try {
        const response = await fetch("/api/state", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state }),
        });
        if (!response.ok) throw new Error(`Не удалось сохранить данные (HTTP ${response.status})`);
        if (!active) return;
        setDatabaseError("");
        setDatabaseStatus("saved");
      } catch (error) {
        console.error("Не удалось сохранить данные Kanbanity в SQLite:", error);
        if (!active) return;
        setDatabaseError(error instanceof Error ? error.message : "Не удалось сохранить данные");
        setDatabaseStatus("error");
      }
    }, 350);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [databaseReady, boardsByProject, workspaceSettings, activity, readNotificationIds, databaseRetry]);

  useEffect(() => {
    localStorage.setItem(storageKeys.readNotifications, JSON.stringify(readNotificationIds));
  }, [readNotificationIds]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0];
  const activeBoard = boardsByProject[activeProjectId] ?? createInitialBoards()[activeProjectId];
  const columns = activeBoard.columns;
  const tasksByColumn = activeBoard.tasksByColumn;
  const unreadNotificationCount = activity.filter((item) => !readNotificationIds.includes(item.id)).length;
  const priorityOrder: Record<Priority, number> = { Срочно: 0, Высокий: 1, Средний: 2, Низкий: 3 };
  const sortTasks = <T extends Task,>(tasks: T[]): T[] => {
    if (sortField === "default") return tasks;
    return [...tasks].sort((a, b) => {
      if (sortField === "dueDate" && (!a.dueDate || !b.dueDate)) {
        if (!a.dueDate && !b.dueDate) return 0;
        return a.dueDate ? -1 : 1;
      }
      const comparison =
        sortField === "priority"
          ? priorityOrder[a.priority] - priorityOrder[b.priority]
          : sortField === "taskNumber"
            ? a.id.localeCompare(b.id, "en", { numeric: true })
          : sortField === "dueDate"
            ? a.dueDate.localeCompare(b.dueDate)
            : a.title.localeCompare(b.title, "ru");
      return sortDirection === "asc" ? comparison : -comparison;
    });
  };
  const allTasks = useMemo(() => Object.values(tasksByColumn).flat(), [tasksByColumn]);
  const allLabels = useMemo(() => [...new Set(allTasks.flatMap((task) => task.labels))].sort(), [allTasks]);
  const visibleTaskCount = useMemo(
    () =>
      allTasks.filter((task) => {
        const searchMatches = `${task.id} ${task.title} ${task.description} ${task.labels.join(" ")}`
          .toLocaleLowerCase("ru")
          .includes(query.trim().toLocaleLowerCase("ru"));
        return (
          searchMatches &&
          (priorityFilter === "Все приоритеты" || task.priority === priorityFilter) &&
          (assigneeFilter === "Все исполнители" || task.assignee === assigneeFilter) &&
          (labelFilter === "Все метки" || task.labels.includes(labelFilter))
        );
      }).length,
    [allTasks, query, priorityFilter, assigneeFilter, labelFilter],
  );

  function updateActiveBoard(update: (board: ProjectBoard) => ProjectBoard) {
    setBoardsByProject((current) => {
      const board = current[activeProjectId] ?? createInitialBoards()[activeProjectId];
      return { ...current, [activeProjectId]: update(board) };
    });
  }

  function updateColumns(update: (current: Column[]) => Column[]) {
    updateActiveBoard((board) => ({ ...board, columns: update(board.columns) }));
  }

  function updateTasks(update: (current: Record<string, Task[]>) => Record<string, Task[]>) {
    updateActiveBoard((board) => ({ ...board, tasksByColumn: update(board.tasksByColumn) }));
  }

  function openProject(projectId: string) {
    if (!projects.some((project) => project.id === projectId)) return;
    setActiveProjectId(projectId);
    setActiveNav("Доска проекта");
    setActiveView("Доска");
    setQuery("");
    setPriorityFilter("Все приоритеты");
    setAssigneeFilter("Все исполнители");
    setLabelFilter("Все метки");
    setModalTask(null);
    setModalColumnId(null);
    setShowFilters(false);
  }

  function openWorkspacePage(page: "Обзор" | "Проекты" | "Команда") {
    setActiveNav(page);
    setShowActivity(false);
    setShowNotifications(false);
  }

  function retryDatabaseConnection() {
    setDatabaseReady(false);
    setDatabaseRetry((attempt) => attempt + 1);
  }

  function openNotifications() {
    setShowNotifications((isOpen) => !isOpen);
  }

  function markAllNotificationsRead() {
    setReadNotificationIds((current) => [...new Set([...current, ...activity.map((item) => item.id)])]);
  }

  function openNotification(item: ActivityItem) {
    setReadNotificationIds((current) => (current.includes(item.id) ? current : [...current, item.id]));
    setShowNotifications(false);
    setActiveNav("Доска проекта");
    setActiveView("Активность");
  }

  function saveWorkspaceSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("workspaceName") ?? "").trim();
    const description = String(formData.get("workspaceDescription") ?? "").trim();
    if (!name) {
      setToast("Введите название пространства");
      return;
    }
    setWorkspaceSettings({ name, description });
    setShowWorkspaceSettings(false);
    setToast("Настройки пространства сохранены");
  }

  function addActivity(message: string) {
    setActivity((current) => [{ id: crypto.randomUUID(), message, time: "только что" }, ...current].slice(0, 8));
  }

  function findTaskColumn(taskId: string) {
    return Object.entries(tasksByColumn).find(([, tasks]) => tasks.some((task) => task.id === taskId))?.[0];
  }

  function saveTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const title = String(formData.get("title") ?? "").trim();
    if (!title) {
      setToast("Введите название задачи");
      return;
    }
    const chosenColumn = String(formData.get("column") ?? modalColumnId ?? columns[0]?.id);
    const isEditing = !!modalTask?.id;
    const sourceColumnId = isEditing ? findTaskColumn(modalTask.id) : undefined;
    const targetColumn = columns.find((column) => column.id === chosenColumn);
    if (!targetColumn) {
      setToast("Выбранная колонка больше не существует");
      return;
    }
    if (
      targetColumn.limit &&
      chosenColumn !== sourceColumnId &&
      (tasksByColumn[chosenColumn]?.length ?? 0) >= targetColumn.limit
    ) {
      setToast(`В колонке «${targetColumn.title}» достигнут WIP-лимит (${targetColumn.limit})`);
      return;
    }
    const task: Task = {
      id: isEditing ? modalTask.id : `${activeProject.prefix}-${Math.max(0, ...allTasks.map((item) => Number(item.id.split("-")[1]) || 0)) + 1}`,
      title,
      description: String(formData.get("description") ?? "").trim(),
      priority: String(formData.get("priority") ?? "Средний") as Priority,
      assignee: String(formData.get("assignee") ?? ""),
      dueDate: String(formData.get("dueDate") ?? ""),
      labels: String(formData.get("labels") ?? "")
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean),
      comments: modalTask?.comments ?? [],
    };
    updateTasks((current) => {
      const next = Object.fromEntries(
        Object.entries(current).map(([columnId, tasks]) => [
          columnId,
          tasks.filter((item) => item.id !== task.id),
        ]),
      );
      next[chosenColumn] = [...(next[chosenColumn] ?? []), task];
      return next;
    });
    const action = isEditing ? "обновлена" : "создана";
    addActivity(`${task.id}: задача «${task.title}» ${action}`);
    setToast(isEditing ? "Изменения сохранены" : "Задача создана");
    setModalTask(null);
    setModalColumnId(null);
  }

  function removeTask(taskId: string) {
    const task = allTasks.find((item) => item.id === taskId);
    updateTasks((current) =>
      Object.fromEntries(Object.entries(current).map(([columnId, tasks]) => [columnId, tasks.filter((item) => item.id !== taskId)])),
    );
    setModalTask(null);
    if (task) addActivity(`${task.id}: задача «${task.title}» удалена`);
    setToast("Задача удалена");
  }

  function moveTask(taskId: string, targetColumnId: string) {
    const sourceColumnId = findTaskColumn(taskId);
    if (!sourceColumnId || sourceColumnId === targetColumnId) return;
    const targetColumn = columns.find((column) => column.id === targetColumnId);
    if (!targetColumn) return;
    if (targetColumn.limit && (tasksByColumn[targetColumnId]?.length ?? 0) >= targetColumn.limit) {
      setToast(`В колонке «${targetColumn.title}» достигнут WIP-лимит (${targetColumn.limit})`);
      return;
    }
    const task = tasksByColumn[sourceColumnId].find((item) => item.id === taskId);
    if (!task) return;
    updateTasks((current) => ({
      ...current,
      [sourceColumnId]: current[sourceColumnId].filter((item) => item.id !== taskId),
      [targetColumnId]: [...(current[targetColumnId] ?? []), task],
    }));
    addActivity(`${task.id}: задача перемещена в «${targetColumn.title}»`);
    setToast(`Задача перемещена в «${targetColumn.title}»`);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, columnId: string) {
    event.preventDefault();
    const taskId = event.dataTransfer.getData("text/plain") || draggedTaskId;
    if (taskId) moveTask(taskId, columnId);
    setDraggedTaskId(null);
  }

  function addColumn() {
    const title = window.prompt("Название новой колонки", "Новая колонка")?.trim();
    if (!title) return;
    const column = { id: `column-${crypto.randomUUID()}`, title, accent: "#7b72e9" };
    updateColumns((current) => [...current, column]);
    updateTasks((current) => ({ ...current, [column.id]: [] }));
    addActivity(`Добавлена колонка «${title}»`);
    setToast("Колонка добавлена");
  }

  function manageColumn(column: Column) {
    const nextTitle = window.prompt("Название колонки. Чтобы удалить, введите /удалить", column.title);
    if (nextTitle === null) return;
    if (nextTitle.trim() === "/удалить") {
      if ((tasksByColumn[column.id]?.length ?? 0) > 0) {
        setToast("Сначала переместите задачи из этой колонки");
        return;
      }
      updateColumns((current) => current.filter((item) => item.id !== column.id));
      updateTasks((current) => {
        const next = { ...current };
        delete next[column.id];
        return next;
      });
      addActivity(`Удалена колонка «${column.title}»`);
      setToast("Колонка удалена");
      return;
    }
    if (nextTitle.trim()) {
      const limitInput = window.prompt("WIP-лимит (оставьте пустым без лимита)", column.limit?.toString() ?? "");
      if (limitInput === null) return;
      const limit = limitInput.trim() ? Number(limitInput) : undefined;
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
        setToast("WIP-лимит должен быть целым числом больше нуля");
        return;
      }
      updateColumns((current) =>
        current.map((item) => (item.id === column.id ? { ...item, title: nextTitle.trim(), limit } : item)),
      );
      setToast("Настройки колонки сохранены");
    }
  }

  function addComment(taskId: string, text: string) {
    const sourceColumnId = findTaskColumn(taskId);
    if (!sourceColumnId || !text.trim()) return;
    const comment = { id: crypto.randomUUID(), author: "Вы", text: text.trim(), createdAt: "только что" };
    updateTasks((current) => ({
      ...current,
      [sourceColumnId]: current[sourceColumnId].map((task) =>
        task.id === taskId ? { ...task, comments: [...task.comments, comment] } : task,
      ),
    }));
    setModalTask((current) => (current?.id === taskId ? { ...current, comments: [...current.comments, comment] } : current));
    addActivity(`${taskId}: добавлен комментарий`);
  }

  function openNewTask(columnId: string) {
    setModalColumnId(columnId);
    setModalTask({
      id: "",
      title: "",
      description: "",
      priority: "Средний",
      assignee: "",
      dueDate: "",
      labels: [],
      comments: [],
    });
  }

  const isEmptyFilter = query || priorityFilter !== "Все приоритеты" || assigneeFilter !== "Все исполнители" || labelFilter !== "Все метки";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(event) => event.preventDefault()} aria-label="Kanbanity">
          <span className="brand-mark"><span /><span /><span /></span>
          <span>kanbanity</span>
        </a>
        <button className="workspace-switch" onClick={() => setShowWorkspaceSettings(true)}>
          <span className="workspace-icon">{workspaceSettings.name.slice(0, 1).toUpperCase()}</span>
          <span className="workspace-copy"><strong>{workspaceSettings.name}</strong><small>{workspaceSettings.description || "Рабочее пространство"}</small></span>
          <ChevronDown size={15} />
        </button>
        <div className="side-section">
          <div className="side-section-title">Рабочее пространство <MoreHorizontal size={16} /></div>
          <NavButton icon={<LayoutDashboard size={17} />} label="Обзор" active={activeNav === "Обзор"} onClick={() => openWorkspacePage("Обзор")} />
          <NavButton icon={<FolderKanban size={17} />} label="Проекты" active={activeNav === "Проекты"} onClick={() => openWorkspacePage("Проекты")} />
          <NavButton icon={<UsersRound size={17} />} label="Команда" active={activeNav === "Команда"} onClick={() => openWorkspacePage("Команда")} />
          <NavButton icon={<Activity size={17} />} label="Активность" active={activeNav === "Активность"} onClick={() => setShowActivity((value) => !value)} />
        </div>
        <div className="side-section projects-section">
          <div className="side-section-title">Ваши проекты <button className="icon-button tiny" aria-label="Все проекты" onClick={() => openWorkspacePage("Проекты")}><Plus size={16} /></button></div>
          {projects.map((project) => <button key={project.id} className={activeNav === "Доска проекта" && activeProjectId === project.id ? "project-link selected" : "project-link"} onClick={() => openProject(project.id)}><span className={`project-dot ${project.color}`}>{project.icon}</span><span>{project.name}</span>{activeProjectId === project.id && <MoreHorizontal size={15} />}</button>)}
        </div>
        <div className="sidebar-bottom">
          <div className="usage-card">
            <div className="usage-top"><Sparkles size={16} /><span>Ваше пространство</span></div>
            <p>{workspaceSettings.description || "Отличная работа! Все проекты в одном месте."}</p>
            <button onClick={() => setShowWorkspaceSettings(true)}>Настроить пространство <ChevronRight size={14} /></button>
          </div>
          <NavButton icon={<CircleHelp size={17} />} label="Помощь и поддержка" onClick={() => setToast("Центр помощи Kanbanity")} />
          <NavButton icon={<Settings2 size={17} />} label="Настройки" onClick={() => setShowWorkspaceSettings(true)} />
          <button className="profile-switch" onClick={() => setToast("Аккаунт Дмитрий Волков")}>
            <span className="avatar blue">ДВ</span><span><strong>Дмитрий Волков</strong><small>Бесплатный план</small></span><MoreHorizontal size={18} />
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs"><button onClick={() => openWorkspacePage("Проекты")}>Проекты</button><ChevronRight size={14} /><strong>{activeNav === "Доска проекта" ? activeProject.name : activeNav}</strong></div>
          <div className="topbar-actions">
            <label className="global-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск задач..." /><kbd><Command size={11} /> K</kbd></label>
            <div className="notification-control">
              <button className="icon-button notification-button" aria-label="Уведомления" aria-expanded={showNotifications} aria-haspopup="dialog" onClick={openNotifications}><Bell size={18} />{unreadNotificationCount > 0 && <i />}</button>
              {showNotifications && <section className="notification-panel" role="dialog" aria-label="Уведомления">
                <header className="notification-panel-header"><div><h2>Уведомления</h2><span>{unreadNotificationCount ? `${unreadNotificationCount} непрочитанных` : "Всё прочитано"}</span></div><button className="icon-button tiny" aria-label="Закрыть уведомления" onClick={() => setShowNotifications(false)}><X size={16} /></button></header>
                {activity.length > 0 ? <div className="notification-list">{activity.map((item, index) => {
                  const isRead = readNotificationIds.includes(item.id);
                  return <button key={item.id} className={isRead ? "notification-item read" : "notification-item unread"} onClick={() => openNotification(item)}><span className={`activity-icon activity-icon-${index % 3}`}><Activity size={15} /></span><span className="notification-copy"><strong>{item.message}</strong><small>{item.time}</small></span>{!isRead && <i className="notification-unread-dot" />}</button>;
                })}</div> : <p className="notifications-empty">Пока нет уведомлений.</p>}
                <footer className="notification-panel-footer"><button onClick={markAllNotificationsRead} disabled={unreadNotificationCount === 0}>Отметить все прочитанными</button><button onClick={() => { setShowNotifications(false); setActiveNav("Доска проекта"); setActiveView("Активность"); }}>Вся активность <ChevronRight size={14} /></button></footer>
              </section>}
            </div>
            <button className="top-avatar avatar blue" onClick={() => setToast("Аккаунт Дмитрий Волков")}>ДВ</button>
          </div>
        </header>

        <div className="page-content">
          {databaseStatus === "error" && <div className="database-status error" role="alert">
            <span className="database-status-dot error" />
            <span>{databaseError}</span>
            <button onClick={retryDatabaseConnection}>Повторить подключение</button>
          </div>}
          {activeNav !== "Доска проекта" ? (
            <WorkspacePage
              page={activeNav}
              projects={projects}
              boards={boardsByProject}
              onOpenProject={openProject}
              onOpenSettings={() => setShowWorkspaceSettings(true)}
              onInvite={() => setToast("Ссылка-приглашение скопирована")}
            />
          ) : (
            <>
          <div className="project-heading">
            <div className="project-title-line">
              <span className={`large-project-icon ${activeProject.color}`}>{activeProject.icon}</span>
              <div><div className="eyebrow">ПРОЕКТ <span className="eyebrow-dot" /> АКТИВЕН</div><h1>{activeProject.name}</h1></div>
              <button className="icon-button title-more" aria-label="Параметры проекта" onClick={() => setToast("Настройки проекта")}><MoreHorizontal size={20} /></button>
            </div>
            <p className="project-description">{activeProject.description}</p>
            <div className="project-meta">
              <div className="member-stack">
                {people.slice(0, 4).map((person) => <span className={`avatar ${person.color}`} key={person.name} title={person.name}>{person.initials}</span>)}
                <button className="avatar add-member" title="Добавить участника" onClick={() => setToast("Приглашение участника") }><Plus size={14} /></button>
              </div>
              <span className="meta-divider" /><span><CalendarDays size={15} /> {activeProject.schedule}</span><span className="meta-divider" />
              <span><CheckCheck size={15} /> {allTasks.filter((task) => findTaskColumn(task.id) === "done").length} из {allTasks.length} задач</span>
              <div className="completion-track"><span style={{ width: `${allTasks.length ? (allTasks.filter((task) => findTaskColumn(task.id) === "done").length / allTasks.length) * 100 : 0}%` }} /></div>
            </div>
          </div>

          <div className="view-toolbar">
            <div className="view-tabs">
              {[
                { name: "Доска", icon: <LayoutDashboard size={15} /> },
                { name: "Список", icon: <ListTodo size={15} /> },
                { name: "Активность", icon: <Activity size={15} /> },
              ].map((view) => <button key={view.name} className={activeView === view.name ? "view-tab active" : "view-tab"} onClick={() => setActiveView(view.name)}>{view.icon}{view.name}</button>)}
              <button className="view-tab add-view" title="Добавить представление" onClick={() => setToast("Другие представления скоро появятся")}><Plus size={16} /></button>
            </div>
            <div className="view-actions">
              <button className="invite-button add-task-cta" onClick={() => openNewTask(columns[0]?.id ?? "")}><Plus size={15} /> Добавить задачу</button>
              <button className={showFilters ? "toolbar-button active-filter" : "toolbar-button"} onClick={() => setShowFilters((value) => !value)}><Filter size={15} /> Фильтры {(priorityFilter !== "Все приоритеты" || assigneeFilter !== "Все исполнители" || labelFilter !== "Все метки") && <span className="filter-count">●</span>}</button>
              <div className="sort-control">
                <button className={showSortMenu || sortField !== "default" ? "toolbar-button active-filter" : "toolbar-button"} aria-haspopup="menu" aria-expanded={showSortMenu} onClick={() => setShowSortMenu((value) => !value)}><ArrowDownWideNarrow size={15} /> {sortField === "default" ? "Сортировка" : `По ${sortField === "taskNumber" ? "номеру задачи" : sortField === "priority" ? "приоритету" : sortField === "dueDate" ? "сроку" : "названию"}`}<ChevronDown size={12} /></button>
                {showSortMenu && <div className="sort-menu" role="menu" aria-label="Сортировка задач">
                  <span className="sort-menu-title">Сортировать по</span>
                  {([
                    ["taskNumber", "Номеру задачи"],
                    ["priority", "Приоритету"],
                    ["dueDate", "Сроку"],
                    ["title", "Названию"],
                  ] as const).map(([field, label]) => <button key={field} role="menuitemradio" aria-checked={sortField === field} className={sortField === field ? "sort-option selected" : "sort-option"} onClick={() => setSortField(field)}>{label}{sortField === field && <Check size={14} />}</button>)}
                  <div className="sort-menu-divider" />
                  <span className="sort-menu-title">Направление</span>
                  <button role="menuitemradio" aria-checked={sortDirection === "asc"} className={sortDirection === "asc" ? "sort-option selected" : "sort-option"} onClick={() => setSortDirection("asc")}><ArrowUp size={14} /> По возрастанию</button>
                  <button role="menuitemradio" aria-checked={sortDirection === "desc"} className={sortDirection === "desc" ? "sort-option selected" : "sort-option"} onClick={() => setSortDirection("desc")}><ArrowDown size={14} /> По убыванию</button>
                  <div className="sort-menu-divider" />
                  <button className="sort-reset" onClick={() => { setSortField("default"); setSortDirection("asc"); setShowSortMenu(false); }}>Сбросить сортировку</button>
                </div>}
              </div>
              <span className="toolbar-divider" />
              <div className="toolbar-avatars">{people.slice(0, 3).map((person) => <span className={`avatar ${person.color}`} key={person.name}>{person.initials}</span>)}</div>
              <button className="invite-button" onClick={() => setToast("Ссылка-приглашение скопирована")}><Plus size={15} /> Пригласить</button>
            </div>
          </div>
          {showFilters && <div className="filter-panel">
            <span><SlidersHorizontal size={15} /> Фильтровать по</span>
            <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}><option>Все приоритеты</option>{Object.keys(priorityMeta).map((priority) => <option key={priority}>{priority}</option>)}</select>
            <select value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)}><option>Все исполнители</option>{people.map((person) => <option key={person.name}>{person.name}</option>)}</select>
            <select value={labelFilter} onChange={(event) => setLabelFilter(event.target.value)}><option>Все метки</option>{allLabels.map((label) => <option key={label}>{label}</option>)}</select>
            <button onClick={() => { setPriorityFilter("Все приоритеты"); setAssigneeFilter("Все исполнители"); setLabelFilter("Все метки"); }}>Сбросить</button>
          </div>}

          {activeView === "Доска" ? (
            <section className="board-scroll" aria-label="Канбан-доска">
              <div className="board-columns">
                {columns.map((column) => {
                  const tasks = sortTasks((tasksByColumn[column.id] ?? []).filter((task) => {
                    const searchMatches = `${task.id} ${task.title} ${task.description} ${task.labels.join(" ")}`.toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru"));
                    return searchMatches && (priorityFilter === "Все приоритеты" || task.priority === priorityFilter) && (assigneeFilter === "Все исполнители" || task.assignee === assigneeFilter) && (labelFilter === "Все метки" || task.labels.includes(labelFilter));
                  }));
                  const isOverLimit = !!column.limit && (tasksByColumn[column.id]?.length ?? 0) > column.limit;
                  return (
                    <div className="board-column" key={column.id} onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleDrop(event, column.id)}>
                      <div className="column-heading">
                        <div className="column-title-wrap"><span className="column-dot" style={{ backgroundColor: column.accent }} /><h2>{column.title}</h2><span className={isOverLimit ? "task-count over-limit" : "task-count"}>{tasksByColumn[column.id]?.length ?? 0}{column.limit ? <span> / {column.limit}</span> : ""}</span></div>
                        <div className="column-controls"><button className="icon-button tiny" aria-label={`Настройки колонки ${column.title}`} onClick={() => manageColumn(column)}><MoreHorizontal size={17} /></button></div>
                      </div>
                      <div className={`task-list ${draggedTaskId ? "drop-ready" : ""}`}>
                        {tasks.map((task) => <TaskCard key={task.id} task={task} onOpen={() => { setModalColumnId(column.id); setModalTask(task); }} onDragStart={(event) => { event.dataTransfer.setData("text/plain", task.id); event.dataTransfer.effectAllowed = "move"; setDraggedTaskId(task.id); }} onDragEnd={() => setDraggedTaskId(null)} />)}
                        {tasks.length === 0 && <div className="empty-column">{isEmptyFilter ? "Нет задач по выбранным фильтрам" : "Перетащите задачу сюда"}</div>}
                      </div>
                    </div>
                  );
                })}
                <button className="add-column-button" onClick={addColumn}><Plus size={17} /> Добавить колонку</button>
              </div>
              {visibleTaskCount === 0 && isEmptyFilter && <div className="no-results"><Search size={20} /><strong>Ничего не найдено</strong><span>Попробуйте изменить запрос или фильтры.</span><button onClick={() => { setQuery(""); setPriorityFilter("Все приоритеты"); setAssigneeFilter("Все исполнители"); setLabelFilter("Все метки"); }}>Сбросить фильтры</button></div>}
            </section>
          ) : activeView === "Список" ? (
            <section className="list-view">
              <div className="list-header"><span>Задача</span><span>Статус</span><span>Исполнитель</span><span>Приоритет</span><span>Срок</span></div>
              {sortTasks(columns.flatMap((column) => (tasksByColumn[column.id] ?? []).map((task) => ({ ...task, column }))).filter((task) => `${task.id} ${task.title} ${task.description}`.toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru")) && (priorityFilter === "Все приоритеты" || task.priority === priorityFilter) && (assigneeFilter === "Все исполнители" || task.assignee === assigneeFilter) && (labelFilter === "Все метки" || task.labels.includes(labelFilter)))).map(({ column, ...task }) => <button className="list-row" key={task.id} onClick={() => { setModalColumnId(column.id); setModalTask(task); }}><span><small>{task.id}</small><strong>{task.title}</strong></span><span className="list-status"><i style={{ background: column.accent }} />{column.title}</span><span><span className={`avatar small ${getPerson(task.assignee).color}`}>{getPerson(task.assignee).initials}</span>{task.assignee || "Не назначен"}</span><PriorityBadge priority={task.priority} /><span>{task.dueDate ? formatDueDate(task.dueDate) : "—"}</span></button>)}
            </section>
          ) : (
            <section className="activity-view">
              <div className="activity-view-heading"><div><h2>Последние события</h2><p>Все изменения в проекте в одном месте.</p></div><button className="toolbar-button" onClick={() => setShowActivity((value) => !value)}><Activity size={15} /> Фильтры активности</button></div>
              {activity.map((item, index) => <div className="activity-row" key={item.id}><span className={`activity-icon activity-icon-${index % 3}`}><Activity size={15} /></span><div><strong>{item.message}</strong><small>{item.time}</small></div></div>)}
            </section>
          )}
          <footer className="board-footer"><span><span className={databaseStatus === "error" ? "database-status-dot error" : "live-dot"} />{databaseStatus === "saved" ? "Изменения сохранены в SQLite" : databaseStatus === "saving" ? "Сохраняем изменения..." : databaseStatus === "error" ? "Ошибка сохранения" : "Подключение к базе данных"}</span><span>Обновлено только что</span></footer>
            </>
          )}
        </div>
      </main>

      {showActivity && <><button className="drawer-backdrop" aria-label="Закрыть активность" onClick={() => setShowActivity(false)} /><aside className="activity-drawer"><div className="drawer-header"><div><span className="eyebrow">ОБНОВЛЕНИЯ</span><h2>Активность</h2></div><button className="icon-button" aria-label="Закрыть" onClick={() => setShowActivity(false)}><X size={18} /></button></div><div className="activity-feed">{activity.map((item, index) => <div className="feed-item" key={item.id}><span className={`activity-icon activity-icon-${index % 3}`}><Activity size={15} /></span><div><p>{item.message}</p><small>{item.time}</small></div></div>)}</div><button className="drawer-link" onClick={() => { setActiveNav("Доска проекта"); setActiveView("Активность"); setShowActivity(false); }}>Вся активность <ChevronRight size={15} /></button></aside></>}

      {showWorkspaceSettings && <WorkspaceSettingsModal settings={workspaceSettings} onClose={() => setShowWorkspaceSettings(false)} onSave={saveWorkspaceSettings} />}
      {modalTask && activeNav === "Доска проекта" && <TaskModal key={modalTask.id || "new"} task={modalTask} columns={columns} initialColumnId={modalColumnId ?? columns[0]?.id ?? ""} onClose={() => { setModalTask(null); setModalColumnId(null); }} onSave={saveTask} onDelete={modalTask.id ? () => removeTask(modalTask.id) : undefined} onAddComment={addComment} />}
      {toast && <div className="toast"><Check size={16} />{toast}<button aria-label="Закрыть уведомление" onClick={() => setToast("")}><X size={14} /></button></div>}
    </div>
  );
}

function NavButton({ icon, label, active = false, onClick }: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return <button className={active ? "nav-button active" : "nav-button"} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function WorkspacePage({ page, projects: projectList, boards, onOpenProject, onOpenSettings, onInvite }: {
  page: string;
  projects: Project[];
  boards: Record<string, ProjectBoard>;
  onOpenProject: (projectId: string) => void;
  onOpenSettings: () => void;
  onInvite: () => void;
}) {
  const taskCount = projectList.reduce(
    (total, project) => total + Object.values(boards[project.id]?.tasksByColumn ?? {}).flat().length,
    0,
  );
  const completedCount = projectList.reduce(
    (total, project) => total + (boards[project.id]?.tasksByColumn.done?.length ?? 0),
    0,
  );

  if (page === "Команда") {
    return (
      <section className="workspace-page">
        <div className="workspace-page-heading"><div><span className="eyebrow">STUDIO NORTH</span><h1>Команда</h1><p>Участники рабочего пространства и их проекты.</p></div><button className="invite-button" onClick={onInvite}><Plus size={15} /> Пригласить участника</button></div>
        <div className="team-grid">
          {people.map((person, index) => (
            <article className="team-card" key={person.name}>
              <span className={`avatar team-avatar ${person.color}`}>{person.initials}</span>
              <strong>{person.name}{person.name === "Дмитрий" && <span className="you-badge">Вы</span>}</strong>
              <span className="team-role">{index === 0 ? "Менеджер проекта" : index === 3 ? "Администратор" : "Разработчик"}</span>
              <div className="team-card-footer"><span><FolderKanban size={14} /> {index === 3 ? projectList.length : 2} проекта</span><button aria-label={`Открыть задачи ${person.name}`} onClick={() => onOpenProject(projectList[index % projectList.length].id)}>Задачи <ChevronRight size={14} /></button></div>
            </article>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="workspace-page">
      <div className="workspace-page-heading">
        <div>
          <span className="eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО</span>
          <h1>{page === "Проекты" ? "Проекты" : "Обзор"}</h1>
          <p>{page === "Проекты" ? "Все проекты и их текущий прогресс." : "Краткая сводка по проектам и задачам команды."}</p>
        </div>
        {page === "Обзор" && <button className="toolbar-button" onClick={onOpenSettings}><Settings2 size={15} /> Настройки пространства</button>}
      </div>
      {page === "Обзор" && (
        <div className="overview-stats">
          <article><span>Активные проекты</span><strong>{projectList.length}</strong><small><FolderKanban size={14} /> Все проекты пространства</small></article>
          <article><span>Всего задач</span><strong>{taskCount}</strong><small><ListTodo size={14} /> Во всех проектах</small></article>
          <article><span>Завершено</span><strong>{completedCount}</strong><small><CheckCheck size={14} /> Задач в статусе «Готово»</small></article>
        </div>
      )}
      <div className="workspace-project-grid">
        {projectList.map((project) => {
          const tasks = Object.values(boards[project.id]?.tasksByColumn ?? {}).flat();
          const done = boards[project.id]?.tasksByColumn.done?.length ?? 0;
          const percent = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
          return (
            <button className="workspace-project-card" key={project.id} onClick={() => onOpenProject(project.id)}>
              <div className="workspace-project-card-top"><span className={`large-project-icon ${project.color}`}>{project.icon}</span><span className="project-card-open">Открыть доску <ChevronRight size={14} /></span></div>
              <h2>{project.name}</h2><p>{project.description}</p>
              <div className="workspace-card-meta"><span><UsersRound size={14} /> {people.length} участника</span><span>{done} / {tasks.length} задач</span></div>
              <div className="workspace-progress"><span style={{ width: `${percent}%` }} /></div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function WorkspaceSettingsModal({ settings, onClose, onSave }: {
  settings: WorkspaceSettings;
  onClose: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="task-modal workspace-settings-modal" onSubmit={onSave}>
        <div className="modal-top"><span className="modal-kicker">РАБОЧЕЕ ПРОСТРАНСТВО</span><button className="icon-button" type="button" aria-label="Закрыть" onClick={onClose}><X size={18} /></button></div>
        <h2>Настройки пространства</h2>
        <p>Изменения сохраняются в этом браузере.</p>
        <label className="settings-field"><span>Название пространства</span><input name="workspaceName" defaultValue={settings.name} maxLength={50} required /></label>
        <label className="settings-field"><span>Описание</span><textarea name="workspaceDescription" defaultValue={settings.description} rows={3} maxLength={160} /></label>
        <div className="modal-footer"><span className="modal-hint">Участники увидят обновлённое название.</span><div><button className="cancel-button" type="button" onClick={onClose}>Отмена</button><button className="save-button" type="submit">Сохранить</button></div></div>
      </form>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: Priority }) {
  const Icon = priorityMeta[priority].icon;
  return <span className={`priority-badge ${priorityMeta[priority].className}`}><Icon size={13} />{priority}</span>;
}

function TaskCard({ task, onOpen, onDragStart, onDragEnd }: { task: Task; onOpen: () => void; onDragStart: (event: DragEvent<HTMLButtonElement>) => void; onDragEnd: () => void }) {
  const person = getPerson(task.assignee);
  return (
    <button className="task-card" draggable onClick={onOpen} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="task-card-top"><span className="task-id">{task.id}</span><MoreHorizontal className="card-more" size={16} /></div>
      <h3>{task.title}</h3>
      {task.description && <p className="task-description">{task.description}</p>}
      {task.labels.length > 0 && <div className="task-labels">{task.labels.map((label, index) => <span className={`task-label label-${index % 4}`} key={`${label}-${index}`}><i />{label}</span>)}</div>}
      <div className="task-card-bottom">
        <PriorityBadge priority={task.priority} />
        <div className="card-meta">
          {task.dueDate && <span className="due-date"><Clock3 size={13} />{formatDueDate(task.dueDate)}</span>}
          {task.comments.length > 0 && <span className="comment-count"><MessageCircle size={13} />{task.comments.length}</span>}
          {task.assignee && <span className={`avatar small ${person.color}`} title={task.assignee}>{person.initials}</span>}
        </div>
      </div>
    </button>
  );
}

function TaskModal({ task, columns, initialColumnId, onClose, onSave, onDelete, onAddComment }: { task: Task; columns: Column[]; initialColumnId: string; onClose: () => void; onSave: (event: FormEvent<HTMLFormElement>) => void; onDelete?: () => void; onAddComment: (taskId: string, text: string) => void }) {
  const [commentText, setCommentText] = useState("");
  const [columnId, setColumnId] = useState(initialColumnId);
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="task-modal" onSubmit={onSave}>
        <input type="hidden" name="column" value={columnId} />
        <div className="modal-top"><span className="modal-kicker">{task.id || "НОВАЯ ЗАДАЧА"} {task.id && <><span className="modal-bullet">·</span> РЕДИЗАЙН ПЛАТФОРМЫ</>}</span><button className="icon-button" type="button" aria-label="Закрыть" onClick={onClose}><X size={18} /></button></div>
        <input className="modal-title-input" name="title" defaultValue={task.title} placeholder="Название задачи" autoFocus required />
        <label className="field-label description-label"><AlignLeft size={15} /> Описание</label>
        <textarea name="description" defaultValue={task.description} placeholder="Добавьте описание задачи..." rows={3} />
        <div className="modal-fields">
          <label><span>Статус</span><select value={columnId} onChange={(event) => setColumnId(event.target.value)}>{columns.map((column) => <option value={column.id} key={column.id}>{column.title}</option>)}</select></label>
          <label><span>Приоритет</span><select name="priority" defaultValue={task.priority}>{Object.keys(priorityMeta).map((priority) => <option key={priority}>{priority}</option>)}</select></label>
          <label><span>Исполнитель</span><select name="assignee" defaultValue={task.assignee}><option value="">Не назначен</option>{people.map((person) => <option key={person.name}>{person.name}</option>)}</select></label>
          <label><span>Срок</span><input type="date" name="dueDate" defaultValue={task.dueDate} /></label>
        </div>
        <label className="field-label"><Tag size={15} /> Метки <small>через запятую</small></label>
        <input name="labels" defaultValue={task.labels.join(", ")} placeholder="Например: Разработка, Дизайн" />
        {task.id && <div className="comments-section"><div className="comments-heading"><strong>Комментарии</strong><span>{task.comments.length}</span></div>{task.comments.map((comment) => <div className="comment" key={comment.id}><span className="avatar small blue">{getPerson(comment.author).initials}</span><div><div className="comment-meta"><strong>{comment.author}</strong><small>{comment.createdAt}</small></div><p>{comment.text}</p></div></div>)}<div className="comment-input-wrap"><span className="avatar small blue">ДВ</span><input value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder="Напишите комментарий..." /><button type="button" aria-label="Отправить комментарий" disabled={!commentText.trim()} onClick={() => { onAddComment(task.id, commentText); setCommentText(""); }}><ChevronRight size={16} /></button></div></div>}
        <div className="modal-footer">{onDelete ? <button className="delete-button" type="button" onClick={onDelete}><Trash2 size={15} /> Удалить</button> : <span className="modal-hint"><span className="live-dot" /> Видно всем участникам проекта</span>}<div><button className="cancel-button" type="button" onClick={onClose}>Отмена</button><button className="save-button" type="submit">{task.id ? "Сохранить" : "Создать задачу"}</button></div></div>
      </form>
    </div>
  );
}

export default App;
