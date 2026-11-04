import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

type TestPersistedState = {
  projects?: Array<{ id: string; name: string; prefix: string }>;
  boardsByProject: Record<string, { columns: unknown[]; tasksByColumn: Record<string, unknown[]> }>;
  workspaceSettings: { name: string; description: string };
  activity: Array<{ id: string; message: string; time: string }>;
  readNotificationIds: string[];
};

let persistedDatabaseState: TestPersistedState | null;

function apiResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response;
}

async function renderApp() {
  const result = render(<App />);
  await waitFor(() =>
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/api/state",
      expect.objectContaining({ method: "PUT" }),
    ),
  );
  return result;
}

function getTaskCard(title: string) {
  return screen.getByRole("button", { name: new RegExp(title) });
}

function getColumn(title: string) {
  const heading = screen.getByRole("heading", { name: title, level: 2 });
  const column = heading.closest(".board-column");
  if (!(column instanceof HTMLElement)) throw new Error(`Не найдена колонка «${title}»`);
  return within(column);
}

async function createTask(user: ReturnType<typeof userEvent.setup>, title: string, columnTitle?: string) {
  await user.click(screen.getByRole("button", { name: "Добавить задачу" }));
  if (columnTitle) {
    await user.selectOptions(screen.getByLabelText("Статус"), screen.getByRole("option", { name: columnTitle }));
  }
  await user.type(screen.getByPlaceholderText("Название задачи"), title);
  await user.click(screen.getByRole("button", { name: "Создать задачу" }));
}

describe("Kanbanity", () => {
  beforeEach(() => {
    localStorage.clear();
    persistedDatabaseState = null;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { state: TestPersistedState };
        persistedDatabaseState = body.state;
        return apiResponse({ saved: true });
      }
      return apiResponse({ state: persistedDatabaseState, updatedAt: null });
    }));
    vi.stubGlobal("crypto", { ...crypto, randomUUID: vi.fn(() => "test-id") });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("отображает доску с колонками и начальными задачами", async () => {
    await renderApp();

    expect(screen.getAllByRole("button", { name: "Добавить задачу" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Добавить задачу в/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Редизайн платформы", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Канбан-доска" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "К выполнению", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "В работе", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "На проверке", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Готово", level: 2 })).toBeInTheDocument();
    expect(getTaskCard("Подготовить карту пользовательского пути")).toBeInTheDocument();
  });

  it("создаёт задачу и сохраняет её после повторного монтирования", async () => {
    const user = userEvent.setup();
    const firstRender = await renderApp();

    await createTask(user, "Проверить новый сценарий");
    expect(getTaskCard("Проверить новый сценарий")).toBeInTheDocument();
    expect(screen.getByText("KAN-27")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        persistedDatabaseState?.boardsByProject.redesign.tasksByColumn.backlog.some((task) =>
          JSON.stringify(task).includes("Проверить новый сценарий"),
        ),
      ).toBe(true),
    );

    firstRender.unmount();
    await renderApp();
    expect(getTaskCard("Проверить новый сценарий")).toBeInTheDocument();
  });

  it("переносит существующие данные из localStorage в базу при первом запуске", async () => {
    localStorage.setItem(
      "kanbanity.project-boards.v1",
      JSON.stringify({
        redesign: {
          columns: [{ id: "backlog", title: "К выполнению", accent: "#8b91a1" }],
          tasksByColumn: {
            backlog: [{
              id: "LEG-1",
              title: "Старая сохранённая задача",
              description: "",
              priority: "Средний",
              assignee: "",
              dueDate: "",
              labels: [],
              comments: [],
            }],
          },
        },
      }),
    );

    render(<App />);
    expect(await screen.findByText("Старая сохранённая задача")).toBeInTheDocument();
    await waitFor(() =>
      expect(persistedDatabaseState?.boardsByProject.redesign.tasksByColumn.backlog).toEqual([
        expect.objectContaining({ id: "LEG-1", title: "Старая сохранённая задача" }),
      ]),
    );
  });

  it("редактирует задачу и удаляет её", async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(getTaskCard("Обновить тексты onboarding"));
    const titleInput = screen.getByPlaceholderText("Название задачи");
    await user.clear(titleInput);
    await user.type(titleInput, "Обновить приветствие");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(getTaskCard("Обновить приветствие")).toBeInTheDocument();
    expect(screen.queryByText("Обновить тексты onboarding")).not.toBeInTheDocument();

    await user.click(getTaskCard("Обновить приветствие"));
    await user.click(screen.getByRole("button", { name: /Удалить/ }));

    expect(screen.queryByText("Обновить приветствие")).not.toBeInTheDocument();
    expect(screen.getByText("Задача удалена")).toBeInTheDocument();
  });

  it("фильтрует задачи по поисковому запросу и очищает результаты", async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.type(screen.getByPlaceholderText("Поиск задач..."), "KAN-21");

    expect(getTaskCard("Интеграция поиска по задачам")).toBeInTheDocument();
    expect(screen.queryByText("Подготовить карту пользовательского пути")).not.toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText("Поиск задач..."));
    expect(getTaskCard("Подготовить карту пользовательского пути")).toBeInTheDocument();
  });

  it("блокирует перенос задачи в колонку, достигшую WIP-лимита", async () => {
    const user = userEvent.setup();
    await renderApp();

    await createTask(user, "Четвёртая задача", "В работе");

    expect(getColumn("В работе").getAllByRole("button", { name: /KAN-/ })).toHaveLength(4);

    await createTask(user, "Пятая задача", "В работе");

    expect(screen.getByText("В колонке «В работе» достигнут WIP-лимит (4)")).toBeInTheDocument();
    expect(getColumn("В работе").getAllByRole("button", { name: /KAN-/ })).toHaveLength(4);
    expect(screen.queryByText("Пятая задача")).not.toBeInTheDocument();
  });

  it("сворачивает задачи в колонке после первых четырёх и позволяет раскрыть их", async () => {
    const user = userEvent.setup();
    await renderApp();

    await createTask(user, "Четвёртая задача");
    await createTask(user, "Пятая задача");
    const backlog = getColumn("К выполнению");

    expect(backlog.getAllByRole("button", { name: /KAN-/ })).toHaveLength(4);
    expect(backlog.queryByRole("button", { name: /Пятая задача/ })).not.toBeInTheDocument();
    expect(backlog.getByRole("button", { name: "Показать ещё 1 задачу" })).toHaveAttribute("aria-expanded", "false");

    await user.click(backlog.getByRole("button", { name: "Показать ещё 1 задачу" }));
    expect(backlog.getAllByRole("button", { name: /KAN-/ })).toHaveLength(5);
    expect(backlog.getByRole("button", { name: /Пятая задача/ })).toBeInTheDocument();
    expect(backlog.getByRole("button", { name: "Свернуть" })).toHaveAttribute("aria-expanded", "true");

    await user.click(backlog.getByRole("button", { name: "Свернуть" }));
    expect(backlog.getAllByRole("button", { name: /KAN-/ })).toHaveLength(4);
    expect(backlog.queryByRole("button", { name: /Пятая задача/ })).not.toBeInTheDocument();
  });

  it("добавляет комментарий к задаче", async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(getTaskCard("Интеграция поиска по задачам"));
    await user.type(screen.getByPlaceholderText("Напишите комментарий..."), "Проверено тестом");
    await user.click(screen.getByRole("button", { name: "Отправить комментарий" }));

    expect(screen.getByText("Проверено тестом")).toBeInTheDocument();
    expect(screen.getByText("Комментарии").parentElement).toHaveTextContent("1");
  });

  it("показывает состояние, когда по запросу нет задач", async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.type(screen.getByPlaceholderText("Поиск задач..."), "несуществующая задача");

    expect(screen.getByText("Ничего не найдено")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Сбросить фильтры" }));
    expect(getTaskCard("Подготовить карту пользовательского пути")).toBeInTheDocument();
  });

  it("сортирует карточки по приоритету в обоих направлениях", async () => {
    const user = userEvent.setup();
    await renderApp();
    const backlog = getColumn("К выполнению");

    await user.click(screen.getByRole("button", { name: /Сортировка/ }));
    await user.click(screen.getByRole("menuitemradio", { name: "Приоритету" }));
    expect(backlog.getAllByRole("button", { name: /KAN-/ }).map((card) => card.textContent)).toEqual([
      expect.stringContaining("KAN-26"),
      expect.stringContaining("KAN-24"),
      expect.stringContaining("KAN-25"),
    ]);

    await user.click(screen.getByRole("menuitemradio", { name: "По убыванию" }));
    expect(backlog.getAllByRole("button", { name: /KAN-/ }).map((card) => card.textContent)).toEqual([
      expect.stringContaining("KAN-25"),
      expect.stringContaining("KAN-24"),
      expect.stringContaining("KAN-26"),
    ]);
  });

  it("сортирует карточки по номеру задачи численно в обоих направлениях", async () => {
    const user = userEvent.setup();
    await renderApp();
    const inProgress = getColumn("В работе");

    await user.click(screen.getByRole("button", { name: /Сортировка/ }));
    await user.click(screen.getByRole("menuitemradio", { name: "Номеру задачи" }));
    expect(inProgress.getAllByRole("button", { name: /KAN-/ }).map((card) => card.textContent?.match(/KAN-\d+/)?.[0])).toEqual([
      "KAN-18",
      "KAN-21",
      "KAN-22",
    ]);

    await user.click(screen.getByRole("menuitemradio", { name: "По убыванию" }));
    expect(inProgress.getAllByRole("button", { name: /KAN-/ }).map((card) => card.textContent?.match(/KAN-\d+/)?.[0])).toEqual([
      "KAN-22",
      "KAN-21",
      "KAN-18",
    ]);
  });

  it("сортирует список задач по названию", async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByRole("button", { name: "Список" }));
    await user.click(screen.getByRole("button", { name: /Сортировка/ }));
    await user.click(screen.getByRole("menuitemradio", { name: "Названию" }));

    const taskTitles = screen.getAllByRole("button", { name: /KAN-/ }).map((row) => row.querySelector("strong")?.textContent);
    expect(taskTitles).toEqual([...taskTitles].sort((a, b) => a!.localeCompare(b!, "ru")));
  });

  it("открывает обзор, каталог проектов и команду через боковую навигацию", async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByRole("button", { name: "Обзор" }));
    expect(screen.getByRole("heading", { name: "Обзор", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Активные проекты")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Проекты" })[0]);
    expect(screen.getByRole("heading", { name: "Проекты", level: 1 })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Мобильное приложение/ }).length).toBeGreaterThan(1);

    await user.click(screen.getByRole("button", { name: "Команда" }));
    expect(screen.getByRole("heading", { name: "Команда", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Александра")).toBeInTheDocument();
  });

  it("переключает проекты на собственные доски и сохраняет их состояние", async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getAllByRole("button", { name: /Мобильное приложение/ })[0]);
    expect(screen.getByRole("heading", { name: "Мобильное приложение", level: 1 })).toBeInTheDocument();
    expect(getTaskCard("Составить карту экранов приложения")).toBeInTheDocument();
    expect(screen.queryByText("Подготовить карту пользовательского пути")).not.toBeInTheDocument();

    await createTask(user, "Задача мобильного проекта");
    await user.click(screen.getAllByRole("button", { name: /Контент-маркетинг/ })[0]);
    expect(screen.getByRole("heading", { name: "Контент-маркетинг", level: 1 })).toBeInTheDocument();
    expect(getTaskCard("Собрать темы для редакционного плана")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: /Мобильное приложение/ })[0]);
    expect(getTaskCard("Задача мобильного проекта")).toBeInTheDocument();
  });

  it("создаёт проект с пустой доской и сохраняет его после повторного открытия", async () => {
    const user = userEvent.setup();
    const firstRender = await renderApp();

    await user.click(screen.getByRole("button", { name: "Создать проект" }));
    await user.type(screen.getByLabelText("Название проекта"), "Новый запуск");
    await user.type(screen.getByLabelText(/Описание/), "Подготовить запуск продукта");
    await user.click(within(screen.getByRole("dialog", { name: "Создать проект" })).getByRole("button", { name: "Создать проект" }));

    expect(screen.getByRole("heading", { name: "Новый запуск", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Подготовить запуск продукта")).toBeInTheDocument();
    expect(screen.getAllByText("Перетащите задачу сюда")).toHaveLength(4);
    await waitFor(() => {
      expect(persistedDatabaseState?.projects).toContainEqual(expect.objectContaining({
        name: "Новый запуск",
        prefix: "PRJ",
      }));
      expect(Object.values(persistedDatabaseState?.boardsByProject ?? {}).some((board) =>
        board.columns.length === 4 && Object.values(board.tasksByColumn).every((tasks) => tasks.length === 0),
      )).toBe(true);
    });

    firstRender.unmount();
    await renderApp();
    expect(screen.getByRole("button", { name: /Новый запуск/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Новый запуск/ }));
    expect(screen.getByRole("heading", { name: "Новый запуск", level: 1 })).toBeInTheDocument();
    expect(screen.getAllByText("Перетащите задачу сюда")).toHaveLength(4);
  });

  it("сохраняет настройки рабочего пространства и показывает их после повторного открытия", async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByRole("button", { name: "Настройки" }));
    await user.clear(screen.getByLabelText("Название пространства"));
    await user.type(screen.getByLabelText("Название пространства"), "Команда Kanbanity");
    await user.clear(screen.getByLabelText("Описание"));
    await user.type(screen.getByLabelText("Описание"), "Планируем работу команды");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(screen.getByText("Команда Kanbanity")).toBeInTheDocument();
    await waitFor(() => expect(persistedDatabaseState?.workspaceSettings).toEqual({
      name: "Команда Kanbanity",
      description: "Планируем работу команды",
    }));

    await user.click(screen.getByRole("button", { name: "Настройки" }));
    expect(screen.getByLabelText("Название пространства")).toHaveValue("Команда Kanbanity");
    expect(screen.getByLabelText("Описание")).toHaveValue("Планируем работу команды");
  });

  it("открывает список уведомлений и отмечает все уведомления прочитанными", async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByRole("button", { name: "Уведомления" }));
    expect(screen.getByRole("dialog", { name: "Уведомления" })).toBeInTheDocument();
    expect(screen.getByText("3 непрочитанных")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Михаил переместил задачу KAN-18/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Отметить все прочитанными" }));
    expect(screen.getByText("Всё прочитано")).toBeInTheDocument();
    await waitFor(() => expect(persistedDatabaseState?.readNotificationIds).toHaveLength(3));

    await user.click(screen.getByRole("button", { name: "Уведомления" }));
    expect(screen.queryByRole("dialog", { name: "Уведомления" })).not.toBeInTheDocument();
  });

  it("открывает активность проекта при выборе уведомления и сохраняет его как прочитанное", async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByRole("button", { name: "Уведомления" }));
    await user.click(screen.getByRole("button", { name: /Вы завершили задачу KAN-12/ }));

    expect(screen.queryByRole("dialog", { name: "Уведомления" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Последние события" })).toBeInTheDocument();
    await waitFor(() => expect(persistedDatabaseState?.readNotificationIds).toContain("a2"));

    await user.click(screen.getByRole("button", { name: "Уведомления" }));
    expect(screen.getByText("2 непрочитанных")).toBeInTheDocument();
  });
});
