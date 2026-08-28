'use client';
import { useState, useMemo, useCallback } from 'react';
import AppLayout from "@/components/app-layout";
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PlusCircle, EllipsisVertical, Pencil, Trash2, Search, StickyNote, XCircle, Pin, X } from 'lucide-react';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { collection, query, orderBy, doc } from 'firebase/firestore';
import { addDocumentNonBlocking, updateDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import type { Note } from '@/lib/data';
import { useToast } from "@/hooks/use-toast";
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

type PresetColor = 'default' | 'yellow' | 'blue' | 'green' | 'pink' | 'purple';

const noteColorClasses: Record<PresetColor, { bg: string, text: string, border: string, shadow: string }> = {
  default: { bg: 'bg-card', text: 'text-card-foreground', border: 'border-border', shadow: 'shadow-sm' },
  yellow: { bg: 'bg-yellow-50 dark:bg-yellow-900/20', text: 'text-yellow-900 dark:text-yellow-200', border: 'border-yellow-200/50 dark:border-yellow-800/50', shadow: 'shadow-yellow-500/5' },
  blue: { bg: 'bg-blue-50 dark:bg-blue-900/20', text: 'text-blue-900 dark:text-blue-200', border: 'border-blue-200/50 dark:border-blue-800/50', shadow: 'shadow-blue-500/5' },
  green: { bg: 'bg-green-50 dark:bg-green-900/20', text: 'text-green-900 dark:text-green-200', border: 'border-green-200/50 dark:border-green-800/50', shadow: 'shadow-green-500/5' },
  pink: { bg: 'bg-pink-50 dark:bg-pink-900/20', text: 'text-pink-900 dark:text-pink-200', border: 'border-pink-200/50 dark:border-pink-800/50', shadow: 'shadow-pink-500/5' },
  purple: { bg: 'bg-purple-50 dark:bg-purple-900/20', text: 'text-purple-900 dark:text-purple-200', border: 'border-purple-200/50 dark:border-purple-800/50', shadow: 'shadow-purple-500/5' },
};

const NoteForm = ({
  onSubmit,
  initialData,
}: {
  onSubmit: (data: Omit<Note, 'id' | 'createdAt'>) => void;
  initialData?: Partial<Note>;
}) => {
  const { toast } = useToast();
  const [title, setTitle] = useState(initialData?.title || '');
  const [content, setContent] = useState(initialData?.content || '');
  const [color, setColor] = useState<string>(initialData?.color || 'default');

  const isPresetColor = (c: string): c is PresetColor => Object.keys(noteColorClasses).includes(c);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) {
      toast({
        variant: "destructive",
        title: "Content required",
        description: "Please enter some content for your note.",
      });
      return;
    }
    onSubmit({ title, content, color });
  };

  return (
    <form id="note-form" onSubmit={handleSubmit} className="grid gap-5 py-2">
      <div className="grid gap-1.5">
        <Label htmlFor="title" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Title (Optional)</Label>
        <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Give your note a title..." className="h-10 text-sm font-medium focus-visible:ring-primary/20" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="content" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Content</Label>
        <Textarea id="content" value={content} onChange={(e) => setContent(e.target.value)} placeholder="Type something important..." required  className="min-h-[150px] text-sm leading-relaxed resize-none focus-visible:ring-primary/20"/>
      </div>
       <div className="grid gap-1.5">
        <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Note Color</Label>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <RadioGroup value={isPresetColor(color) ? color : ''} onValueChange={setColor} className="flex flex-wrap gap-2">
            {(Object.keys(noteColorClasses) as PresetColor[]).map((key) => (
              <Label key={key} title={key} className={cn('h-8 w-8 rounded-full cursor-pointer border-2 transition-all hover:scale-110 active:scale-95', noteColorClasses[key].bg, color === key ? 'ring-2 ring-offset-2 ring-primary ring-offset-background border-primary/50' : 'border-transparent')}>
                <RadioGroupItem value={key} className="sr-only"/>
              </Label>
            ))}
          </RadioGroup>
          
          <div className="relative h-8 w-8">
             <Label htmlFor="custom-color" className={cn('h-8 w-8 rounded-full cursor-pointer border-2 flex items-center justify-center transition-all hover:scale-110 active:scale-95', !isPresetColor(color) ? 'ring-2 ring-offset-2 ring-primary ring-offset-background border-primary/50' : 'border-transparent', isPresetColor(color) && 'bg-muted/50')}>
                <div className="w-5 h-5 rounded-full" style={{ backgroundColor: !isPresetColor(color) ? color : undefined, backgroundImage: isPresetColor(color) ? 'conic-gradient(from 90deg, #ff0000, #ff00ff, #0000ff, #00ffff, #00ff00, #ffff00, #ff0000)' : undefined }} />
             </Label>
             <Input 
                id="custom-color"
                type="color"
                value={isPresetColor(color) ? '#000000' : color}
                onChange={(e) => setColor(e.target.value)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
             />
          </div>
        </div>
      </div>
    </form>
  );
};

export default function NotesPage() {
  const { firestore, user } = useFirebase();
  const { toast } = useToast();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [noteToDelete, setNoteToDelete] = useState<Note | null>(null);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const notesQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return query(collection(firestore, 'notes'), orderBy('createdAt', 'desc'));
  }, [firestore, user]);

  const { data: notes, isLoading } = useCollection<Note>(notesQuery);

  const filteredNotes = useMemo(() => {
    if (!notes) return [];
    if (!searchTerm.trim()) return notes;
    const lower = searchTerm.toLowerCase();
    return notes.filter(n => 
      n.title?.toLowerCase().includes(lower) || 
      n.content.toLowerCase().includes(lower)
    );
  }, [notes, searchTerm]);

  const closeAllDialogs = useCallback(() => {
      setIsFormOpen(false);
      setNoteToDelete(null);
      setSelectedNote(null);
  }, []);

  const handleDelayedAction = (action: () => void) => {
    setTimeout(action, 100);
  };

  const openFormDialog = useCallback((note: Note | null) => {
    closeAllDialogs();
    setSelectedNote(note);
    handleDelayedAction(() => setIsFormOpen(true));
  }, [closeAllDialogs]);

  const openDeleteDialog = useCallback((note: Note) => {
    closeAllDialogs();
    handleDelayedAction(() => setNoteToDelete(note));
  }, [closeAllDialogs]);

  const handleFormSubmit = (formData: Omit<Note, 'id' | 'createdAt'>) => {
    if (!firestore || !user) return;

    if (selectedNote) {
      const noteDocRef = doc(firestore, 'notes', selectedNote.id);
      updateDocumentNonBlocking(noteDocRef, formData);
      toast({ title: "Updated", description: "Note successfully updated." });
    } else {
      const notesCollection = collection(firestore, 'notes');
      addDocumentNonBlocking(notesCollection, {
        ...formData,
        createdAt: new Date().toISOString(),
      });
      toast({ title: "Added", description: "New note saved." });
    }
    closeAllDialogs();
  };

  const handleDelete = () => {
    if (!firestore || !noteToDelete) return;
    
    const noteDocRef = doc(firestore, 'notes', noteToDelete.id);
    deleteDocumentNonBlocking(noteDocRef);

    toast({
      title: "Deleted",
      description: "The note has been removed.",
    });

    setNoteToDelete(null);
  };
  
  return (
    <AppLayout>
      <div className="flex flex-col gap-4 sm:gap-6 animate-in fade-in duration-500 w-full max-w-full overflow-x-hidden min-w-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 w-full">
            <div className="space-y-1 min-w-0">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
                    <StickyNote className="h-7 w-7 sm:h-8 sm:w-8 text-primary shrink-0" />
                    <span className="truncate">Quick Notes</span>
                </h1>
                <p className="text-xs sm:text-sm text-muted-foreground">Keep your thoughts and workshop reminders in one place.</p>
            </div>
            <Button onClick={() => openFormDialog(null)} className="shadow-lg shadow-primary/20 h-10 px-4 group shrink-0 self-start sm:self-auto">
                <PlusCircle className="mr-2 h-4 w-4 transition-transform group-hover:rotate-90" />
                Add Note
            </Button>
        </div>

        <Card className="border-none shadow-sm bg-card/50 backdrop-blur-sm w-full max-w-full overflow-hidden">
          <CardHeader className="p-4 border-b border-border/50">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 w-full">
                <div className="relative group max-w-md w-full">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                    <Input
                        type="search"
                        placeholder="Search titles or content..."
                        className="pl-9 pr-10 w-full h-10 border-muted focus-visible:ring-primary/30"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    {searchTerm && (
                        <button 
                            onClick={() => setSearchTerm('')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </div>
                {searchTerm && (
                    <div className="text-[10px] sm:text-xs font-bold text-muted-foreground uppercase tracking-widest px-2">
                        Found {filteredNotes.length} matching notes
                    </div>
                )}
            </div>
          </CardHeader>
        </Card>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 w-full">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-48 rounded-xl bg-muted animate-pulse border border-border/50 w-full"></div>
            ))}
          </div>
        ) : filteredNotes.length > 0 ? (
          <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4 space-y-4 w-full">
            {filteredNotes.map((note, index) => {
              const isPresetColor = (c: string): c is PresetColor => Object.keys(noteColorClasses).includes(c);
              
              let cardDynamicStyle: React.CSSProperties = {};
              let textDynamicStyle: React.CSSProperties = {};
              let cardDynamicClass = '';
              let textDynamicClass = '';
              let footerDynamicStyle: React.CSSProperties = {};

              if (isPresetColor(note.color)) {
                  const preset = noteColorClasses[note.color];
                  cardDynamicClass = `${preset.bg} ${preset.border} ${preset.shadow}`;
                  textDynamicClass = preset.text;
              } else {
                  cardDynamicStyle = { backgroundColor: note.color, border: '1px solid transparent' };
                  try {
                      const hex = note.color.replace('#', '');
                      const r = parseInt(hex.substring(0, 2), 16);
                      const g = parseInt(hex.substring(2, 4), 16);
                      const b = parseInt(hex.substring(4, 6), 16);
                      const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
                      const textColor = yiq >= 128 ? '#18181b' : '#fafafa';
                      textDynamicStyle = { color: textColor };
                      footerDynamicStyle = { color: textColor, opacity: 0.7 };
                  } catch(e) {
                      textDynamicStyle = { color: 'hsl(var(--card-foreground))' };
                  }
              }

              return (
                <div key={note.id} className="break-inside-avoid w-full min-w-0 mb-4">
                  <Card 
                    className={cn(
                      "group relative flex flex-col transition-all duration-300 hover:shadow-md hover:-translate-y-1 rounded-xl overflow-hidden w-full max-w-full min-w-0 break-words", 
                      cardDynamicClass
                    )} 
                    style={cardDynamicStyle}
                  >
                    <CardHeader className="flex flex-row items-start justify-between pb-1 pt-3 px-4 min-w-0">
                      <div className="flex-1 pr-4 min-w-0 overflow-hidden">
                          <span className={cn("text-[10px] font-black uppercase tracking-widest opacity-50 block truncate", textDynamicClass)} style={textDynamicStyle}>
                              Note #{index + 1}
                          </span>
                      </div>
                       <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className={cn("h-7 w-7 -mt-1 -mr-1 rounded-full hover:bg-black/5 dark:hover:bg-white/5 shrink-0", textDynamicClass)} style={textDynamicStyle}>
                                  <EllipsisVertical className="h-3.5 w-3.5" />
                              </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-36">
                              <DropdownMenuItem onSelect={() => openFormDialog(note)} className="cursor-pointer">
                                  <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => openDeleteDialog(note)} className="text-destructive focus:bg-destructive/10 cursor-pointer">
                                  <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
                              </DropdownMenuItem>
                          </DropdownMenuContent>
                      </DropdownMenu>
                    </CardHeader>
                    <CardContent className="py-1 px-4 min-w-0 overflow-hidden">
                      {note.title && (
                        <h4 className={cn("text-sm font-bold mb-1 leading-tight break-words [overflow-wrap:anywhere]", textDynamicClass)} style={textDynamicStyle}>
                          {note.title}
                        </h4>
                      )}
                      <p className={cn("whitespace-pre-wrap text-xs sm:text-sm leading-snug break-words [overflow-wrap:anywhere]", textDynamicClass)} style={textDynamicStyle}>
                          {note.content}
                      </p>
                    </CardContent>
                    <CardFooter className="pt-1 pb-3 px-4 flex items-center justify-between mt-auto min-w-0">
                      <span className="text-[9px] font-bold uppercase tracking-tight truncate pr-2" style={footerDynamicStyle}>
                          {format(new Date(note.createdAt), "dd MMM yyyy")}
                      </span>
                      <Pin className="h-2.5 w-2.5 opacity-20 group-hover:opacity-100 transition-opacity shrink-0" style={textDynamicStyle}/>
                    </CardFooter>
                  </Card>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="h-20 w-20 rounded-full bg-primary/5 flex items-center justify-center mb-4">
                {searchTerm ? <Search className="h-10 w-10 text-primary opacity-20" /> : <StickyNote className="h-10 w-10 text-primary opacity-20" />}
            </div>
            <h3 className="text-xl font-bold text-foreground">
                {searchTerm ? 'No matching notes' : 'No notes captured yet'}
            </h3>
            <p className="text-sm text-muted-foreground mt-2 max-w-xs mx-auto">
                {searchTerm ? 'Try a different search term or clear the filter.' : 'Start recording important ideas or workshop reminders by clicking "Add Note".'}
            </p>
            {searchTerm && (
                <Button variant="outline" onClick={() => setSearchTerm('')} className="mt-4 text-xs font-bold uppercase tracking-widest h-9">
                    Clear Search
                </Button>
            )}
          </div>
        )}
      </div>

       <Dialog open={isFormOpen} onOpenChange={(open) => !open && closeAllDialogs()}>
        <DialogContent className="max-w-[95vw] sm:max-w-lg p-0 rounded-2xl overflow-hidden border-none shadow-2xl">
          <DialogHeader className="p-6 sm:p-8 pb-0">
            <DialogTitle className="text-2xl font-black text-foreground">{selectedNote ? 'Modify Note' : 'Capture Thought'}</DialogTitle>
            <DialogDescription className="text-sm font-medium text-muted-foreground pt-1">
                {selectedNote ? 'Update your existing note details.' : 'Quickly jot down something important for later.'}
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 sm:p-8 py-4">
            <NoteForm
                onSubmit={handleFormSubmit}
                initialData={selectedNote || undefined}
            />
          </div>
           <DialogFooter className="p-6 sm:p-8 pt-4 border-t border-border/50 bg-muted/10 gap-3">
              <Button variant="ghost" type="button" onClick={closeAllDialogs} className="h-11 rounded-xl font-bold text-muted-foreground hover:text-foreground">
                Discard
              </Button>
              <Button type="submit" form="note-form" className="h-11 rounded-xl font-bold bg-primary px-8 shadow-lg shadow-primary/20">
                {selectedNote ? 'Confirm Update' : 'Save Note'}
              </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <AlertDialog open={!!noteToDelete} onOpenChange={(open) => !open && closeAllDialogs()}>
        <AlertDialogContent className="max-w-[90vw] sm:max-w-md p-6 rounded-2xl border-none shadow-2xl">
          <AlertDialogHeader>
            <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center mb-2 mx-auto sm:mx-0">
                <Trash2 className="h-6 w-6 text-destructive" />
            </div>
            <AlertDialogTitle className="text-xl font-black">Delete Note?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm font-medium leading-relaxed">
              This will permanently erase this note. You cannot undo this action.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-6 flex flex-col sm:flex-row gap-2">
            <AlertDialogCancel className="h-11 rounded-xl font-bold border-muted">Keep Note</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="h-11 rounded-xl font-bold bg-destructive hover:bg-destructive/90 shadow-lg shadow-destructive/20">Yes, Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </AppLayout>
  );
}
