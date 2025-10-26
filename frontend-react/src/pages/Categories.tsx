// frontend-react/src/pages/Categories.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { Plus, Edit, Trash2, Save, X } from 'lucide-react';

// Интерфейс для категории
interface Category {
  id: number;
  name: string;
}

// --- БЕЗОПАСНАЯ ОБРАБОТКА ОШИБОК AXIOS (Из вашего фикса) ---
interface AxiosErrorLike extends Error {
  response?: {
    data: {
      error?: string;
    };
  };
  message: string;
}
const isAxiosErrorLike = (error: unknown): error is AxiosErrorLike => {
  return (
    typeof error === 'object' && 
    error !== null && 
    'message' in error && 
    typeof (error as AxiosErrorLike).message === 'string' &&
    'response' in error 
  );
};
// ----------------------------------------------------------------

const Categories: React.FC = () => {
  const { axiosInstance } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [categoryName, setCategoryName] = useState(''); // Для формы создания
  const [isEditing, setIsEditing] = useState<number | null>(null); // ID редактируемой категории
  const [editName, setEditName] = useState(''); // Для формы редактирования
  const [formError, setFormError] = useState(''); // Ошибка для формы

  // Функция для загрузки категорий (аналогична вашей)
  const fetchCategories = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await axiosInstance.get('/categories');
      setCategories(response.data.categories || []);
    } catch (err) {
      console.error("Не удалось загрузить категории:", err);
      let errorMessage = "Не удалось загрузить категории. Попробуйте войти снова.";
      if (isAxiosErrorLike(err)) {
        if (err.response && err.response.data.error) {
          errorMessage = err.response.data.error;
        } else if (err.message) {
          errorMessage = `Ошибка запроса: ${err.message}`; 
        }
      } else if (err instanceof Error) {
        errorMessage = err.message;
      }
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [axiosInstance]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  // --- CREATE: Обработчик создания категории ---
  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (categoryName.trim() === '') {
      setFormError('Название категории не может быть пустым.');
      return;
    }

    try {
      const response = await axiosInstance.post('/categories', { name: categoryName.trim() });
      // Обновляем список, добавляя новую категорию, которую вернул бэкенд
      setCategories((prev) => [...prev, response.data.category]); 
      setCategoryName(''); // Очищаем поле
    } catch (err) {
      console.error("Ошибка при создании категории:", err);
      let errorMessage = "Не удалось создать категорию.";
      if (isAxiosErrorLike(err) && err.response?.data?.error) {
        errorMessage = err.response.data.error;
      }
      setFormError(errorMessage);
    }
  };

  // --- UPDATE: Установка режима редактирования ---
  const startEdit = (category: Category) => {
    setIsEditing(category.id);
    setEditName(category.name);
    setFormError('');
  };

  // --- UPDATE: Обработчик сохранения изменений ---
  const handleUpdateCategory = async (categoryId: number) => {
    setFormError('');

    if (editName.trim() === '') {
      setFormError('Название категории не может быть пустым.');
      return;
    }

    try {
      const response = await axiosInstance.put(`/categories/${categoryId}`, { name: editName.trim() });

      // Обновляем список: находим и заменяем измененный элемент
      setCategories((prev) => 
        prev.map((cat) => (cat.id === categoryId ? response.data.category : cat))
      );
      setIsEditing(null); // Выходим из режима редактирования
      setEditName('');
    } catch (err) {
      console.error("Ошибка при обновлении категории:", err);
      let errorMessage = "Не удалось обновить категорию.";
      if (isAxiosErrorLike(err) && err.response?.data?.error) {
        errorMessage = err.response.data.error;
      }
      setFormError(errorMessage);
    }
  };

  // --- DELETE: Обработчик удаления категории ---
const handleDeleteCategory = async (categoryId: number) => {
 setFormError('');
// 💡 ИСПРАВЛЕННЫЙ ТЕКСТ: предупреждает о блокировке, а не об удалении транзакций
 if (!window.confirm("Вы уверены, что хотите удалить эту категорию? Удаление будет заблокировано, если с ней связаны транзакции.")) {
return;
 }

    try {
      await axiosInstance.delete(`/categories/${categoryId}`);

      // Обновляем список: удаляем категорию из состояния
      setCategories((prev) => prev.filter((cat) => cat.id !== categoryId));
    } catch (err) {
      console.error("Ошибка при удалении категории:", err);
      let errorMessage = "Не удалось удалить категорию.";
      if (isAxiosErrorLike(err) && err.response?.data?.error) {
        errorMessage = err.response.data.error;
      }
      setFormError(errorMessage);
    }
  };


  // --- РЕНДЕРИНГ ---

  if (loading) {
    return <div className="p-6 text-center text-gray-500">Загрузка категорий...</div>;
  }

  if (error) {
    return <div className="p-6 text-center text-red-500 font-bold">{error}</div>;
  }

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-8">Управление категориями</h1>

      {formError && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
            <span className="block sm:inline">{formError}</span>
          </div>
      )}

      {/* Секция для добавления категории (CREATE) */}
      <div className="bg-white p-6 rounded-lg shadow-md mb-8">
        <h2 className="text-xl font-semibold mb-4 flex items-center">
            <Plus className="inline w-5 h-5 mr-2 text-green-600" />
            Добавить новую категорию
        </h2>
        <form onSubmit={handleCreateCategory} className="flex space-x-3">
          <input
            type="text"
            value={categoryName}
            onChange={(e) => setCategoryName(e.target.value)}
            placeholder="Название категории (например, 'Еда', 'Дом')"
            className="flex-grow p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
            required
          />
          <button
            type="submit"
            className="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg transition duration-150"
          >
            Создать
          </button>
        </form>
      </div>

      {/* Список категорий (READ, UPDATE, DELETE) */}
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h2 className="text-xl font-semibold mb-4">Существующие категории ({categories.length})</h2>
        {categories.length === 0 ? (
          <p className="text-gray-500">У вас пока нет категорий.</p>
        ) : (
          <ul className="space-y-3">
            {categories.map((category) => (
              <li 
                key={category.id} 
                className="flex justify-between items-center p-3 border rounded-lg bg-gray-50 hover:bg-gray-100 transition duration-100"
              >
                {isEditing === category.id ? (
                  // Режим редактирования
                  <form 
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleUpdateCategory(category.id);
                    }}
                    className="flex-grow flex space-x-3"
                  >
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-grow p-1 border border-blue-400 rounded-lg"
                      required
                    />
                    <button 
                      type="submit"
                      title="Сохранить"
                      className="text-green-500 hover:text-green-700 p-1 rounded-full"
                    >
                      <Save className="w-5 h-5" />
                    </button>
                    <button 
                      type="button"
                      title="Отменить"
                      onClick={() => setIsEditing(null)}
                      className="text-red-500 hover:text-red-700 p-1 rounded-full"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </form>
                ) : (
                  // Режим просмотра
                  <>
                    <span className="font-medium text-gray-700">{category.name}</span>
                    <div className="space-x-2">
                      <button 
                        className="text-blue-500 hover:text-blue-700 p-1 rounded-full"
                        title="Редактировать"
                        onClick={() => startEdit(category)}
                      >
                        <Edit className="w-5 h-5" />
                      </button>
                      <button 
                        className="text-red-500 hover:text-red-700 p-1 rounded-full"
                        title="Удалить"
                        onClick={() => handleDeleteCategory(category.id)}
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default Categories;