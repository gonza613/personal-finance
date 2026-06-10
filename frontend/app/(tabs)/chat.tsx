import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, FlatList, ActivityIndicator, KeyboardAvoidingView, Platform, Keyboard } from 'react-native';
import { supabase } from '../../src/utils/supabaseClient';
import { Ionicons } from '@expo/vector-icons';

interface Message {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  timestamp: Date;
}

const QUICK_SUGGESTIONS = [
  '¿Cuánto gasté en total?',
  '¿Qué promos tengo en supermercados?',
  '¿Qué tarjeta me conviene usar hoy?',
  '¿Puedo comprar una cafetera de $50000?',
];

export default function ChatScreen() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'ai',
      text: '¡Hola! Soy tu asistente financiero personal con Inteligencia Artificial. Pregúntame sobre tus gastos del mes o consulta qué promociones bancarias te convienen hoy.',
      timestamp: new Date(),
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  const handleSend = async (text: string) => {
    if (!text.trim()) return;

    const userMsg: Message = {
      id: Date.now().toString() + '-user',
      sender: 'user',
      text: text.trim(),
      timestamp: new Date(),
    };

    setMessages((prev: Message[]) => [...prev, userMsg]);
    setInputText('');
    setLoading(true);
    Keyboard.dismiss();

    try {
      // Llamar a la Supabase Edge Function 'ai-chat'
      const { data, error } = await supabase.functions.invoke('ai-chat', {
        body: { message: userMsg.text },
      });

      if (error) throw error;

      const replyText = data?.reply || 'Lo siento, no obtuve respuesta del asistente.';
      const aiMsg: Message = {
        id: Date.now().toString() + '-ai',
        sender: 'ai',
        text: replyText,
        timestamp: new Date(),
      };

      setMessages((prev: Message[]) => [...prev, aiMsg]);
    } catch (error: any) {
      console.error('Error invoking chat function:', error);
      const errorMsg: Message = {
        id: Date.now().toString() + '-error',
        sender: 'ai',
        text: `Lo siento, ocurrió un error al comunicarme con el servidor: ${error.message || 'Error desconocido'}.`,
        timestamp: new Date(),
      };
      setMessages((prev: Message[]) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const renderMessageItem = ({ item }: { item: Message }) => {
    const isUser = item.sender === 'user';
    return (
      <View style={[styles.messageRow, isUser ? styles.userRow : styles.aiRow]}>
        {!isUser && (
          <View style={styles.avatar}>
            <Ionicons name="sparkles" size={16} color="#6366F1" />
          </View>
        )}
        <View style={[styles.bubble, isUser ? styles.userBubble : styles.aiBubble]}>
          <Text style={[styles.messageText, isUser ? styles.userText : styles.aiText]}>
            {item.text}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      style={styles.container}
    >
      {/* Mensajes */}
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessageItem}
        keyExtractor={(item: Message) => item.id}
        contentContainerStyle={styles.chatList}
        showsVerticalScrollIndicator={false}
        ListFooterComponent={
          loading ? (
            <View style={styles.loadingContainer}>
              <View style={styles.avatar}>
                <Ionicons name="sparkles" size={16} color="#6366F1" />
              </View>
              <View style={[styles.bubble, styles.aiBubble, styles.loadingBubble]}>
                <ActivityIndicator size="small" color="#6366F1" />
              </View>
            </View>
          ) : null
        }
      />

      {/* Sugerencias Rápidas */}
      {messages.length === 1 && !loading && (
        <View style={styles.suggestionsContainer}>
          <Text style={styles.suggestionsTitle}>Sugerencias:</Text>
          <View style={styles.suggestionsGrid}>
            {QUICK_SUGGESTIONS.map((suggestion, idx) => (
              <TouchableOpacity
                key={idx}
                style={styles.suggestionChip}
                onPress={() => handleSend(suggestion)}
              >
                <Text style={styles.suggestionText}>{suggestion}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Input */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Escribe tu mensaje aquí..."
          placeholderTextColor="#64748B"
          value={inputText}
          onChangeText={setInputText}
          multiline={false}
          onSubmitEditing={() => handleSend(inputText)}
          returnKeyType="send"
        />
        <TouchableOpacity style={styles.sendButton} onPress={() => handleSend(inputText)} disabled={loading}>
          <Ionicons name="send" size={18} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  chatList: {
    padding: 16,
    paddingBottom: 24,
  },
  messageRow: {
    flexDirection: 'row',
    marginBottom: 16,
    alignItems: 'flex-end',
    maxWidth: '85%',
  },
  userRow: {
    alignSelf: 'flex-end',
    justifyContent: 'flex-end',
  },
  aiRow: {
    alignSelf: 'flex-start',
    justifyContent: 'flex-start',
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#00000010',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#00000020',
  },
  bubble: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexShrink: 1,
  },
  userBubble: {
    backgroundColor: '#000000',
    borderBottomRightRadius: 4,
  },
  aiBubble: {
    backgroundColor: '#F3F4F6',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  loadingBubble: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  messageText: {
    fontSize: 14,
    lineHeight: 20,
  },
  userText: {
    color: '#FFFFFF',
  },
  aiText: {
    color: '#000000',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 16,
  },
  suggestionsContainer: {
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  suggestionsTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#666666',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  suggestionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  suggestionChip: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  suggestionText: {
    color: '#666666',
    fontSize: 13,
    fontWeight: '500',
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E5E5',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    height: 44,
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    paddingHorizontal: 18,
    color: '#000000',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    marginRight: 10,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
