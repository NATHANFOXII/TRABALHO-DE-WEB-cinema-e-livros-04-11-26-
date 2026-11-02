// ================= VARIÁVEIS GLOBAIS E DOM =================
let savedItems = JSON.parse(localStorage.getItem('javivover_lista')) || [];
let currentApiItem = null;

const formBusca = document.getElementById('form-busca');
const inputBuscaTitulo = document.getElementById('busca-titulo');
const selectBuscaTipo = document.getElementById('busca-tipo');
const divResultados = document.getElementById('resultados-busca');
const divListaSalva = document.getElementById('lista-salva');
const msgVazio = document.getElementById('msg-vazio');

const divSugestao = document.getElementById('sugestao-ortografica');
const termoSugerido = document.getElementById('termo-sugerido');

// Filtros
const formFiltros = document.getElementById('form-filtros');
const filtroTipo = document.getElementById('filtro-tipo');
const filtroGenero = document.getElementById('filtro-genero');
const filtroAno = document.getElementById('filtro-ano');

// Modal Elements
const modal = document.getElementById('modal-item');
const btnFecharModal = document.getElementById('fechar-modal');
const formSalvar = document.getElementById('form-salvar');
const btnDeletarModal = document.getElementById('btn-deletar-modal');

let debounceTimer;

// Imagem de "sem capa" embutida (o via.placeholder.com saiu do ar)
const SEM_CAPA = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="100%" height="100%" fill="#1f2029"/><text x="50%" y="50%" fill="#888" font-size="22" text-anchor="middle" font-family="sans-serif">Sem Capa</text></svg>'
);

// Evita que textos vindos da API quebrem o HTML
function esc(t) {
    return String(t ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// iTunes: tenta fetch normal; se o navegador bloquear por CORS, usa JSONP (callback), que a Apple suporta
function buscarJSONP(url) {
    return new Promise((resolve, reject) => {
        const nome = 'itunesCb_' + Date.now();
        const script = document.createElement('script');
        const limpar = () => { delete window[nome]; script.remove(); };
        window[nome] = data => { limpar(); resolve(data); };
        script.onerror = () => { limpar(); reject(new Error('Falha ao carregar o script JSONP')); };
        script.src = `${url}&callback=${nome}`;
        document.body.appendChild(script);
    });
}
async function buscarItunes(url) {
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
    } catch (erro) {
        console.warn('fetch falhou, tentando JSONP:', erro);
        return buscarJSONP(url);
    }
}

// ================= INICIALIZAÇÃO =================
document.addEventListener('DOMContentLoaded', () => {
    atualizarFiltroGeneros();
    renderSavedItems();
});

// ================= SUGESTÃO ORTOGRÁFICA (Apenas Correção) =================
async function buscarSugestaoOrtografica(termo) {
    if (termo.length < 3) {
        divSugestao.classList.add('hidden');
        return;
    }
    try {
        const res = await fetch(`https://api.datamuse.com/sug?s=${encodeURIComponent(termo)}`);
        const data = await res.json();
        
        if (data.length > 0 && data[0].word.toLowerCase() !== termo.toLowerCase()) {
            termoSugerido.textContent = data[0].word;
            divSugestao.classList.remove('hidden');
        } else {
            divSugestao.classList.add('hidden');
        }
    } catch (error) {
        divSugestao.classList.add('hidden');
    }
}

// O evento 'input' serve APENAS para sugerir a correção. NÃO faz busca de filmes.
inputBuscaTitulo.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        buscarSugestaoOrtografica(inputBuscaTitulo.value.trim());
    }, 400);
});

// ================= CONSUMO DE API (BUSCA MANUAL) =================

// Clicar na sugestão
termoSugerido.addEventListener('click', () => {
    inputBuscaTitulo.value = termoSugerido.textContent;
    divSugestao.classList.add('hidden');
    realizarBusca(); 
});

// Clicar no botão Buscar ou dar Enter
formBusca.addEventListener('submit', (e) => {
    e.preventDefault();
    divSugestao.classList.add('hidden');
    realizarBusca();
});

async function realizarBusca() {
    const query = inputBuscaTitulo.value.trim();
    const tipo = selectBuscaTipo.value;
    
    if (query.length < 3) return;

    divResultados.innerHTML = '<p class="msg-empty">⏳ A procurar na base de dados...</p>';
    divResultados.classList.remove('hidden');

    try {
        let resultados = [];
        
        if (tipo === 'filme') {
            // Adicionado country=BR para garantir resultados corretos no iTunes
            const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=movie&country=BR&limit=30`;
            const data = await buscarItunes(url);
            
            if (data.results && data.results.length > 0) {
                resultados = data.results.map(item => ({
                    id: item.trackId ? item.trackId.toString() : Math.random().toString(),
                    tipo: 'filme',
                    titulo: item.trackName || 'Sem Título',
                    imagem: item.artworkUrl100 ? item.artworkUrl100.replace('100x100', '600x600') : SEM_CAPA,
                    genero: item.primaryGenreName || 'Desconhecido',
                    ano: item.releaseDate ? item.releaseDate.substring(0, 4) : 'N/D',
                    sinopse: item.longDescription || 'Sem sinopse.',
                    trailer: item.previewUrl || null
                }));
            }
        } else {
            const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=30`;
            const res = await fetch(url);
            if (!res.ok) throw new Error('Google Books respondeu HTTP ' + res.status);
            const data = await res.json();
            
            if (data.items && data.items.length > 0) {
                resultados = data.items.map(item => ({
                    id: item.id,
                    tipo: 'livro',
                    titulo: item.volumeInfo.title || 'Sem Título',
                    imagem: item.volumeInfo.imageLinks && item.volumeInfo.imageLinks.thumbnail ? item.volumeInfo.imageLinks.thumbnail.replace('http:', 'https:') : SEM_CAPA,
                    genero: item.volumeInfo.categories ? item.volumeInfo.categories[0] : 'Desconhecido',
                    ano: item.volumeInfo.publishedDate ? item.volumeInfo.publishedDate.substring(0, 4) : 'N/D',
                    sinopse: item.volumeInfo.description || 'Sem sinopse.',
                    trailer: null
                }));
            }
        }

        renderResultadosBusca(resultados);
        
    } catch (error) {
        console.error('Erro na busca:', error);
        divResultados.innerHTML = `<p class="msg-empty" style="color: var(--danger);">Erro: Não foi possível ligar à base de dados (${esc(error.message)}). Tente novamente mais tarde.</p>`;
    }
}

// ================= RENDERIZAÇÃO DOM (BUSCA) =================
function renderResultadosBusca(resultados) {
    divResultados.innerHTML = '';
    
    if(!resultados || resultados.length === 0) {
        divResultados.innerHTML = '<p class="msg-empty">Nenhum resultado encontrado. Tente outro termo.</p>';
        return;
    }

    resultados.forEach(item => {
        const card = document.createElement('div');
        card.classList.add('card');
        card.innerHTML = `
            <img src="${esc(item.imagem)}" alt="Capa de ${esc(item.titulo)}">
            <div class="card-body">
                <h3 class="card-title">${esc(item.titulo)}</h3>
                <div>
                    <span class="badge">${esc(item.ano)}</span>
                    <span class="badge">${esc(item.genero)}</span>
                </div>
            </div>
        `;
        card.addEventListener('click', () => abrirModal(item, false));
        divResultados.appendChild(card);
    });
}

// ================= CRUD (CRIAR, LER, ATUALIZAR, APAGAR) =================
function abrirModal(itemData, isEditMode = false) {
    currentApiItem = itemData;
    
    document.getElementById('modal-titulo').textContent = itemData.titulo;
    document.getElementById('modal-img').src = itemData.imagem;
    document.getElementById('modal-genero').textContent = itemData.genero;
    document.getElementById('modal-ano').textContent = itemData.ano;
    document.getElementById('modal-sinopse').textContent = itemData.sinopse;

    const trailerContainer = document.getElementById('trailer-container');
    const trailerVideo = document.getElementById('modal-trailer');
    if (itemData.trailer) {
        trailerVideo.src = itemData.trailer;
        trailerContainer.classList.remove('hidden');
    } else {
        trailerVideo.src = "";
        trailerContainer.classList.add('hidden');
    }

    document.getElementById('item-id').value = isEditMode ? itemData.id : '';
    document.getElementById('item-status').value = isEditMode ? itemData.status : 'Quero ver/ler';
    document.getElementById('item-comentario').value = isEditMode ? itemData.comentario : '';
    
    const btnSalvar = document.getElementById('btn-salvar-modal');
    
    if(isEditMode) {
        btnDeletarModal.classList.remove('hidden');
        btnSalvar.textContent = 'Salvar Alterações';
    } else {
        btnDeletarModal.classList.add('hidden');
        btnSalvar.textContent = 'Salvar na minha lista';
    }

    modal.classList.remove('hidden');
}

formSalvar.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const id = document.getElementById('item-id').value;
    const status = document.getElementById('item-status').value;
    const comentario = document.getElementById('item-comentario').value;

    if (id) {
        const index = savedItems.findIndex(i => i.id === id);
        if(index !== -1) {
            savedItems[index].status = status;
            savedItems[index].comentario = comentario;
        }
    } else {
        if(savedItems.find(i => i.id === currentApiItem.id)) {
            alert('Este título já está guardado na sua lista!');
            return;
        }
        const novoItem = { ...currentApiItem, status: status, comentario: comentario };
        savedItems.push(novoItem);
    }

    salvarNoLocalStorage();
    fecharModal();
});

btnDeletarModal.addEventListener('click', () => {
    const id = document.getElementById('item-id').value;
    if(confirm('Tem a certeza de que pretende eliminar este item da sua lista?')) {
        savedItems = savedItems.filter(item => item.id !== id);
        salvarNoLocalStorage();
        fecharModal();
    }
});

function renderSavedItems() {
    divListaSalva.innerHTML = '';
    const tipo = filtroTipo.value;
    const genero = filtroGenero.value;
    const ano = filtroAno.value;

    const filtrados = savedItems.filter(item => {
        const matchTipo = tipo === '' || item.tipo === tipo;
        const matchGenero = genero === '' || item.genero === genero;
        const matchAno = ano === '' || item.ano === ano;
        return matchTipo && matchGenero && matchAno;
    });

    if(filtrados.length === 0) {
        msgVazio.classList.remove('hidden');
    } else {
        msgVazio.classList.add('hidden');
        filtrados.forEach(item => {
            const card = document.createElement('div');
            card.classList.add('card');
            const iconeTipo = item.tipo === 'filme' ? '🎬' : '📖';

            card.innerHTML = `
                <img src="${esc(item.imagem)}" alt="Capa de ${esc(item.titulo)}">
                <div class="card-body">
                    <h3 class="card-title">${esc(item.titulo)}</h3>
                    <div>
                        <span class="badge">${iconeTipo} ${item.tipo.toUpperCase()}</span>
                        <span class="badge">${esc(item.ano)}</span>
                    </div>
                    <span class="badge status-badge">${esc(item.status)}</span>
                </div>
            `;
            card.addEventListener('click', () => abrirModal(item, true));
            divListaSalva.appendChild(card);
        });
    }
}

function atualizarFiltroGeneros() {
    const generosUnicos = savedItems.reduce((acc, item) => {
        if (!acc.includes(item.genero)) acc.push(item.genero);
        return acc;
    }, []);
    
    filtroGenero.innerHTML = '<option value="">Todos os géneros</option>';
    generosUnicos.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        filtroGenero.appendChild(opt);
    });
}

[filtroTipo, filtroGenero, filtroAno].forEach(input => {
    input.addEventListener('change', renderSavedItems);
    input.addEventListener('keyup', renderSavedItems);
});

function salvarNoLocalStorage() {
    localStorage.setItem('javivover_lista', JSON.stringify(savedItems));
    atualizarFiltroGeneros();
    renderSavedItems();
    divResultados.innerHTML = '';
    divResultados.classList.add('hidden');
    document.getElementById('busca-titulo').value = '';
}

function fecharModal() {
    modal.classList.add('hidden');
    const trailerVideo = document.getElementById('modal-trailer');
    if (!trailerVideo.paused) {
        trailerVideo.pause();
    }
}

btnFecharModal.addEventListener('click', fecharModal);
window.addEventListener('click', (e) => {
    if (e.target === modal) fecharModal();
});